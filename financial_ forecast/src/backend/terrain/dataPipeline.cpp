// Asset parsing, income/density joins, geometry reduction and product serialization.
// Parsers are the RapidJSON/RapidXML already shipped with bundled RichDEM.
#include "dataPipeline.hpp"
#include "terrainDEM.hpp"
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iterator>
#include <iomanip>
#include <limits>
#include <map>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>
#include <cereal/external/rapidjson/document.h>
#include <cereal/external/rapidjson/stringbuffer.h>
#include <cereal/external/rapidjson/writer.h>
#include <cereal/external/rapidxml/rapidxml.hpp>

namespace terrain {
namespace {
using JSON = rapidjson::Value;
using Buffer = rapidjson::StringBuffer;
using Writer = rapidjson::Writer<Buffer>;
using Node = rapidxml::xml_node<>;
using XY = std::array<double, 2>;
// One workbook table: its latest dated column, keyed by normalized authority name.
struct Table { std::map<std::string, double> values; std::string year;
    std::map<std::string,std::map<std::string,double>> history; };

std::vector<char> readChars(const std::filesystem::path& path) {
    std::ifstream file(path, std::ios::binary | std::ios::ate);
    if (!file) throw std::runtime_error("Could not read source: " + path.string());
    const auto size = file.tellg();
    if (size < 0) throw std::runtime_error("Invalid source size.");
    std::vector<char> data(static_cast<std::size_t>(size) + 1, '\0');
    file.seekg(0); file.read(data.data(), size);
    if (!file) throw std::runtime_error("Could not read complete source.");
    return data;
}

void text(Writer& writer, const std::string& value) {
    writer.String(value.c_str(), static_cast<rapidjson::SizeType>(value.size()));
}
void key(Writer& writer, const char* value) { writer.String(value, std::strlen(value)); }
std::string normalized(const std::string& name) {
    std::string result;
    for (unsigned char c : name) {
        if (c >= 'A' && c <= 'Z') c += 'a' - 'A';
        if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) result += c;
    }
    for (const auto* label : {"lpa", "cityof"}) {
        std::size_t position;
        while ((position = result.find(label)) != std::string::npos) result.erase(position, std::strlen(label));
    }
    return result;
}
std::string localName(const char* name) {
    const char* colon = std::strchr(name, ':');
    return colon ? colon + 1 : name;
}
Node* child(Node* node, const char* name) {
    for (auto* item = node ? node->first_node() : nullptr; item; item = item->next_sibling())
        if (localName(item->name()) == name) return item;
    return nullptr;
}
std::string richText(Node* node) {
    if (!node) return {};
    if (localName(node->name()) == "t") return {node->value(), node->value_size()};
    std::string result;
    for (auto* item = node->first_node(); item; item = item->next_sibling()) result += richText(item);
    return result;
}
bool localAuthority(const std::string& code) {
    if (code.size() != 9) return false;
    const auto prefix = code.substr(0, 3);
    if (prefix != "E06" && prefix != "E07" && prefix != "E08" && prefix != "E09" &&
        prefix != "W06" && prefix != "S12" && prefix != "N09") return false;
    return std::all_of(code.begin()+3, code.end(), [](char c) { return c >= '0' && c <= '9'; });
}
std::optional<double> number(std::string value) {
    value.erase(std::remove(value.begin(), value.end(), ','), value.end());
    if (value.empty()) return std::nullopt;
    char* end = nullptr;
    const double result = std::strtod(value.c_str(), &end);
    if (*end || !std::isfinite(result) || result < 0) return std::nullopt;
    return result;
}
Table readTable(const std::filesystem::path& stringsPath, const std::filesystem::path& sheetPath, const char* label) {
    auto stringsData = readChars(stringsPath), sheetData = readChars(sheetPath);
    rapidxml::xml_document<> stringsXML, sheetXML;
    stringsXML.parse<rapidxml::parse_no_data_nodes>(stringsData.data());
    sheetXML.parse<rapidxml::parse_no_data_nodes>(sheetData.data());
    auto* sst = child(&stringsXML, "sst");
    auto* rows = child(child(&sheetXML, "worksheet"), "sheetData");
    if (!sst || !rows) throw std::runtime_error(std::string("Invalid workbook XML for ") + label + ".");
    std::vector<std::string> shared;
    for (auto* item = sst->first_node(); item; item = item->next_sibling()) shared.push_back(richText(item));
    Table result;
    std::string latest;
    int valueColumn = -1;
    std::map<std::string,std::pair<std::string,int>> columns;
    for (auto* row = rows->first_node(); row; row = row->next_sibling()) {
        std::map<int, std::string> cells;
        for (auto* cell = row->first_node(); cell; cell = cell->next_sibling()) {
            auto* ref = cell->first_attribute("r");
            if (!ref) continue;
            int column = 0;
            for (const char* c = ref->value(); *c >= 'A' && *c <= 'Z'; ++c) column = column*26 + *c-'A'+1;
            auto* type = cell->first_attribute("t");
            std::string value;
            if (type && std::string(type->value()) == "inlineStr") value = richText(child(cell, "is"));
            else {
                auto* v = child(cell, "v");
                if (!v) continue;
                value.assign(v->value(), v->value_size());
                if (type && std::string(type->value()) == "s") {
                    const auto index = std::stoul(value);
                    if (index >= shared.size()) throw std::runtime_error("Invalid shared-string index.");
                    value = shared[index];
                }
            }
            cells[column-1] = std::move(value);
        }
        if (valueColumn < 0) {
            if (cells[0] != "Area code" || cells[1] != "Area name") continue;
            // Headers start with an ISO date: "2024-01-01/P1Y (...)" or "2025-06-30 (Persons)".
            for (const auto& [column, heading] : cells) {
                if (column >= 2 && heading.size() >= 10 && heading[4] == '-' && heading[7] == '-' &&
                    std::all_of(heading.begin(), heading.begin()+4, [](char c) { return c >= '0' && c <= '9'; }) &&
                    !heading.empty()) {
                    const auto year=heading.substr(0,4), date=heading.substr(0,10);
                    if (!columns.count(year) || date>columns[year].first) columns[year]={date,column};
                    if(date>latest) { valueColumn=column; latest=date; }
                }
            }
            if (valueColumn < 0) throw std::runtime_error(std::string("No dated column in ") + label + ".");
            result.year = latest.substr(0,4);
            continue;
        }
        if (!localAuthority(cells[0]) || cells[1].empty()) continue;
        for (const auto& [year, entry] : columns) {
            if (const auto v=number(cells[entry.second])) result.history[year][normalized(cells[1])]=*v;
        }
        const auto value = number(cells[valueColumn]);
        if (!value) continue;
        const auto name = normalized(cells[1]);
        const auto previous = result.values.find(name);
        if (previous != result.values.end() && previous->second != *value)
            throw std::runtime_error(std::string("Ambiguous ") + label + " records for " + cells[1]);
        result.values[name] = *value;
    }
    if (valueColumn < 0 || result.values.empty()) throw std::runtime_error(std::string("No local-authority records in ") + label + ".");
    return result;
}

const JSON& field(const JSON& object, const char* name) {
    if (!object.IsObject() || !object.HasMember(name)) throw std::runtime_error(std::string("Missing boundary field: ")+name);
    return object[name];
}
std::string stringField(const JSON& object, const char* name) {
    const auto& value = field(object, name);
    if (!value.IsString()) throw std::runtime_error("Expected a text boundary property.");
    return {value.GetString(), value.GetStringLength()};
}
double numericField(const JSON& object, const char* name) {
    const auto& value = field(object, name);
    if (!value.IsNumber() || !std::isfinite(value.GetDouble())) throw std::runtime_error("Expected a numeric boundary property.");
    return value.GetDouble();
}
double squared(const XY& a, const XY& b) {
    const double dx = a[0]-b[0], dy = a[1]-b[1]; return dx*dx+dy*dy;
}
std::vector<XY> simplifyRing(const JSON& ring) {
    if (!ring.IsArray() || ring.Size() < 3) throw std::runtime_error("Invalid polygon ring.");
    constexpr double tolerance = .0008, radial = tolerance*tolerance/9;
    std::vector<XY> original, points;
    original.reserve(ring.Size());
    for (rapidjson::SizeType i = 0; i < ring.Size(); ++i) {
        const auto& point = ring[i];
        if (!point.IsArray() || point.Size() < 2 || !point[0u].IsNumber() || !point[1u].IsNumber())
            throw std::runtime_error("Invalid polygon coordinate.");
        original.push_back({point[0u].GetDouble(), point[1u].GetDouble()});
    }
    if (original.front() == original.back()) original.pop_back();
    points.push_back(original.front());
    for (std::size_t i = 1; i < original.size(); ++i)
        if (squared(original[i], points.back()) > radial) points.push_back(original[i]);
    if (points.size() < 3) points = std::move(original);
    if (points.size() <= 3) { points.push_back(points.front()); return points; }
    std::size_t split = 1;
    for (std::size_t i = 2; i < points.size(); ++i)
        if (squared(points[i], points.front()) > squared(points[split], points.front())) split = i;
    const auto last = points.size();
    points.push_back(points.front());
    std::set<std::size_t> keep = {0, split, last};
    std::vector<std::pair<std::size_t,std::size_t>> stack = {{0,split},{split,last}};
    while (!stack.empty()) {
        const auto [start,end] = stack.back(); stack.pop_back();
        const auto a = points[start], b = points[end];
        const double dx = b[0]-a[0], dy = b[1]-a[1], length = dx*dx+dy*dy;
        auto farthest = start;
        double maximum = tolerance*tolerance;
        for (auto i = start+1; i < end; ++i) {
            const auto p = points[i];
            const double t = length ? std::clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length,0.,1.) : 0.;
            const double ex = p[0]-a[0]-t*dx, ey = p[1]-a[1]-t*dy, distance = ex*ex+ey*ey;
            if (distance > maximum) { farthest = i; maximum = distance; }
        }
        if (farthest != start) { keep.insert(farthest); stack.push_back({start,farthest}); stack.push_back({farthest,end}); }
    }
    if (keep.size() < 4) {
        std::size_t third = 1;
        double maximum = -1;
        const auto a = points[0], b = points[split];
        for (std::size_t i = 1; i < last; ++i) if (i != split) {
            const double area = std::abs((b[0]-a[0])*(points[i][1]-a[1])-(b[1]-a[1])*(points[i][0]-a[0]));
            if (area > maximum) { third = i; maximum = area; }
        }
        keep.insert(third);
    }
    std::vector<XY> result;
    for (const auto i : keep) result.push_back(points[i]);
    return result;
}
void polygon(Writer& writer, const JSON& rings) {
    if (!rings.IsArray()) throw std::runtime_error("Invalid polygon coordinates.");
    writer.StartArray();
    for (rapidjson::SizeType i = 0; i < rings.Size(); ++i) {
        writer.StartArray();
        for (const auto& p : simplifyRing(rings[i])) {
            writer.StartArray();
            writer.Double(std::round(p[0]*1e5)/1e5); writer.Double(std::round(p[1]*1e5)/1e5);
            writer.EndArray();
        }
        writer.EndArray();
    }
    writer.EndArray();
}
void geometry(Writer& writer, const JSON& value) {
    const auto type = stringField(value, "type");
    const auto& coordinates = field(value, "coordinates");
    writer.StartObject(); key(writer,"type"); text(writer,type); key(writer,"coordinates");
    if (type == "Polygon") polygon(writer,coordinates);
    else if (type == "MultiPolygon" && coordinates.IsArray()) {
        writer.StartArray();
        for (rapidjson::SizeType i = 0; i < coordinates.Size(); ++i) polygon(writer,coordinates[i]);
        writer.EndArray();
    } else throw std::runtime_error("Unsupported boundary geometry: " + type);
    writer.EndObject();
}
struct Feature { std::string code, name; std::optional<double> income, density; };
void properties(Writer& writer, const Feature& feature) {
    writer.StartObject(); key(writer,"authority_code"); text(writer,feature.code);
    key(writer,"authority_name"); text(writer,feature.name); key(writer,"income_per_head");
    if (feature.income) writer.Double(*feature.income); else writer.Null_();
    key(writer,"population_density");
    if (feature.density) writer.Double(*feature.density); else writer.Null_();
    writer.EndObject();
}
// Density heights are log10(residents per km²), rescaled by writeDEM to 0–1000:
// log10 density = log10Range[0] + height / 1000 * (log10Range[1] - log10Range[0]).
struct DensitySummary { unsigned matched = 0; std::array<double, 2> log10Range{}; };
DensitySummary summarize(const std::vector<Sample>& samples) {
    DensitySummary summary{static_cast<unsigned>(samples.size()), {0, 0}};
    if (samples.empty()) return summary;
    summary.log10Range = {samples.front()[2], samples.front()[2]};
    for (const auto& sample : samples) {
        summary.log10Range[0] = std::min(summary.log10Range[0], sample[2]);
        summary.log10Range[1] = std::max(summary.log10Range[1], sample[2]);
    }
    return summary;
}
void metadata(Writer& writer, const Table& income, const Table& density, unsigned matched,
              const DensitySummary& densitySummary, unsigned total) {
    writer.StartObject(); key(writer,"metric"); text(writer,"Gross disposable household income per head");
    key(writer,"source_year"); text(writer,income.year);
    key(writer,"elevation_range_m"); writer.StartArray(); writer.Int(0); writer.Int(1000); writer.EndArray();
    key(writer,"matched_authorities"); writer.Uint(matched);
    key(writer,"unmatched_authorities"); writer.Uint(total-matched);
    key(writer,"bounds"); writer.StartArray(); for (double bound : GridSpec{}.bounds) writer.Double(bound); writer.EndArray();
    key(writer,"method"); text(writer,"Smoothed inverse-distance interpolation of income samples; synthetic elevation, not geographic altitude");
    key(writer,"engine"); text(writer,"terrainDEM.cpp"); key(writer,"dem_backend"); text(writer,"RichDEM");
    key(writer,"data_pipeline"); text(writer,"dataPipeline.cpp");
    key(writer,"population_density"); writer.StartObject();
    key(writer,"metric"); text(writer,"Population density");
    key(writer,"units"); text(writer,"residents per square kilometre");
    key(writer,"source_year"); text(writer,density.year);
    key(writer,"matched_authorities"); writer.Uint(densitySummary.matched);
    key(writer,"height_scale"); text(writer,"log10");
    key(writer,"log10_range"); writer.StartArray();
    writer.Double(densitySummary.log10Range[0]); writer.Double(densitySummary.log10Range[1]); writer.EndArray();
    key(writer,"method"); text(writer,"Smoothed inverse-distance interpolation of log10 density samples into its own RichDEM grid (density_dem); synthetic elevation, not geographic altitude");
    writer.EndObject(); writer.EndObject();
}
}

void writeIncome(std::ostream& out, const std::filesystem::path& sharedStrings, const std::filesystem::path& worksheet) {
    const auto income = readTable(sharedStrings,worksheet,"workbook table");
    Buffer buffer; Writer writer(buffer,9);
    writer.StartObject(); key(writer,"source_year"); text(writer,income.year);
    key(writer,"income_by_name"); writer.StartObject();
    for (const auto& [name,value] : income.values) { text(writer,name); writer.Double(value); }
    writer.EndObject(); writer.EndObject(); out << buffer.GetString();
}

void writeSimplifiedGeometry(std::istream& input, std::ostream& out) {
    std::string data((std::istreambuf_iterator<char>(input)), {});
    rapidjson::Document document; document.Parse<0>(data.c_str());
    if (document.HasParseError()) throw std::runtime_error("Invalid geometry JSON.");
    Buffer buffer; Writer writer(buffer,9); geometry(writer,document); out << buffer.GetString();
}

void buildHistory(const std::filesystem::path& boundaries, const std::filesystem::path& sharedStrings,
                  const std::filesystem::path& incomeSheet, const std::filesystem::path& densitySheet,
                  const std::filesystem::path& output, const std::filesystem::path& context) {
    const auto income=readTable(sharedStrings,incomeSheet,"income"), density=readTable(sharedStrings,densitySheet,"density");
    auto source=readChars(boundaries);
    rapidjson::Document doc; doc.ParseInsitu<0>(source.data());
    if(doc.HasParseError()) throw std::runtime_error("Invalid boundaries.");
    const auto& features=field(doc,"features");
    struct Location {std::string code,name; double lon,lat;};
    std::vector<Location> locations;
    for(rapidjson::SizeType i=0;i<features.Size();++i) {
        const auto& p=field(features[i],"properties");
        locations.push_back({stringField(p,"LPA26CD"),normalized(stringField(p,"LPA26NM")),numericField(p,"LONG"),numericField(p,"LAT")});
    }
    std::ofstream out(output); out.exceptions(std::ios::badbit|std::ios::failbit);
    Buffer facts; Writer f(facts,9); f.StartObject(); out << '{';
    bool first=true;
    for(const auto& [name,table] : std::vector<std::pair<std::string,const Table*>>{{"income",&income},{"density",&density}}) {
        double low=std::numeric_limits<double>::infinity(), high=-low;
        for(const auto& [year,values] : table->history) for(const auto& place:locations) {
            const auto v=values.find(place.name);
            if(v==values.end() || (name=="density" && v->second<1))continue;
            const double value=name=="density"?std::log10(v->second):v->second;
            low=std::min(low,value);high=std::max(high,value);
        }
        if(!std::isfinite(low)) throw std::runtime_error("No historical observations.");
        if(!first)out << ',';first=false;
        out << '"' << name << "\":{\"range\":[" << std::setprecision(12) << low << ',' << high << "],\"frames\":[";
        key(f,name.c_str()); f.StartObject(); bool firstYear=true;
        for(const auto& [year,values] : table->history) {
            std::vector<Sample> samples; Buffer observations; Writer w(observations,9); w.StartObject();
            for(const auto& place:locations) {
                const auto value=values.find(place.name);
                if(value==values.end() || (name=="density" && value->second<1))continue;
                text(w,place.code);w.Double(value->second);
                samples.push_back({place.lon,place.lat,name=="density"?std::log10(value->second):value->second});
            }
            w.EndObject(); if(samples.empty())continue;
            if(!firstYear)out << ',';firstYear=false;
            out << "{\"year\":\"" << year << "\",\"observations\":" << observations.GetString() << ",\"values\":";
            GridSpec spec; spec.valueRange=std::array<double,2>{low,high};spec.valuesOnly=true;
            writeDEM(out,spec,samples); out << '}';
            text(f,year); rapidjson::Document valuesDoc; valuesDoc.Parse<0>(observations.GetString());valuesDoc.Accept(f);
        }
        out << "]}";f.EndObject();
    }
    out << '}'; f.EndObject();std::ofstream factsOut(context);factsOut.exceptions(std::ios::badbit|std::ios::failbit);factsOut << facts.GetString();
}

void buildProduct(const std::filesystem::path& boundaries, const std::filesystem::path& sharedStrings,
                  const std::filesystem::path& incomeSheet, const std::filesystem::path& densitySheet,
                  const std::filesystem::path& output, const std::filesystem::path& context) {
    const auto income = readTable(sharedStrings,incomeSheet,"income workbook tab 16");
    const auto density = readTable(sharedStrings,densitySheet,"population density workbook tab 3");
    auto source = readChars(boundaries);
    rapidjson::Document document; document.ParseInsitu<0>(source.data());
    if (document.HasParseError()) throw std::runtime_error("Invalid planning-authority GeoJSON.");
    const auto& features = field(document,"features");
    if (!features.IsArray()) throw std::runtime_error("Expected a GeoJSON feature array.");
    std::vector<Feature> records;
    std::vector<Sample> samples, densitySamples;
    for (rapidjson::SizeType i = 0; i < features.Size(); ++i) {
        const auto& props = field(features[i],"properties");
        Feature record{stringField(props,"LPA26CD"),stringField(props,"LPA26NM"),std::nullopt,std::nullopt};
        const auto lookup = normalized(record.name);
        if (const auto found = density.values.find(lookup); found != density.values.end() && found->second >= 1) {
            record.density = found->second;
            densitySamples.push_back({numericField(props,"LONG"),numericField(props,"LAT"),std::log10(found->second)});
        }
        const auto match = income.values.find(lookup);
        if (match != income.values.end()) {
            record.income = match->second;
            samples.push_back({numericField(props,"LONG"),numericField(props,"LAT"),*record.income});
        }
        records.push_back(std::move(record));
    }
    if (samples.empty()) throw std::runtime_error("No boundaries match the income dataset.");
    if (densitySamples.empty()) throw std::runtime_error("No boundaries match the population density dataset.");
    const auto densitySummary = summarize(densitySamples);
    std::ofstream out(output, std::ios::binary); out.exceptions(std::ios::badbit | std::ios::failbit);
    out << "{\"type\":\"FeatureCollection\",\"features\":[";
    for (rapidjson::SizeType i = 0; i < features.Size(); ++i) {
        Buffer buffer; Writer writer(buffer,9);
        writer.StartObject(); key(writer,"type"); text(writer,"Feature");
        key(writer,"geometry"); geometry(writer,field(features[i],"geometry"));
        key(writer,"properties"); properties(writer,records[i]); writer.EndObject();
        if (i) out << ',';
        out << buffer.GetString();
    }
    out << "],\"dem\":"; writeDEM(out,GridSpec{},samples);
    // Same grid, interpolation, RichDEM slope and native contours as the income terrain.
    out << ",\"density_dem\":";
    writeDEM(out,GridSpec{},densitySamples,"Log10 population-density synthetic elevation");
    out << ",\"metadata\":";
    Buffer meta; Writer metaWriter(meta,9); metadata(metaWriter,income,density,samples.size(),densitySummary,records.size());
    out << meta.GetString() << '}'; out.close();
    Buffer facts; Writer writer(facts,9);
    writer.StartObject(); key(writer,"metadata"); metadata(writer,income,density,samples.size(),densitySummary,records.size());
    key(writer,"authorities"); writer.StartObject();
    for (const auto& record : records) { text(writer,record.code); properties(writer,record); }
    writer.EndObject(); writer.EndObject();
    std::ofstream sidecar(context, std::ios::binary); sidecar.exceptions(std::ios::badbit | std::ios::failbit);
    sidecar << facts.GetString();
}
}
