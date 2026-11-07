// Asset parsing, income join, geometry reduction and product serialization.
// Parsers are the RapidJSON/RapidXML already shipped with bundled RichDEM.
#include "dataPipeline.hpp"
#include "terrainDEM.hpp"
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iterator>
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
struct Income { std::map<std::string, double> values; std::string year; };

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
Income readIncome(const std::filesystem::path& stringsPath, const std::filesystem::path& sheetPath) {
    auto stringsData = readChars(stringsPath), sheetData = readChars(sheetPath);
    rapidxml::xml_document<> stringsXML, sheetXML;
    stringsXML.parse<rapidxml::parse_no_data_nodes>(stringsData.data());
    sheetXML.parse<rapidxml::parse_no_data_nodes>(sheetData.data());
    auto* sst = child(&stringsXML, "sst");
    auto* rows = child(child(&sheetXML, "worksheet"), "sheetData");
    if (!sst || !rows) throw std::runtime_error("Invalid income workbook XML.");
    std::vector<std::string> shared;
    for (auto* item = sst->first_node(); item; item = item->next_sibling()) shared.push_back(richText(item));
    Income result;
    int incomeColumn = -1;
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
        if (incomeColumn < 0) {
            if (cells[0] != "Area code" || cells[1] != "Area name") continue;
            for (const auto& [column, label] : cells)
                if (label.size() >= 14 && label[4] == '-' && label[7] == '-' && label.substr(10,4) == "/P1Y" &&
                    label.substr(0,4) > result.year) { incomeColumn = column; result.year = label.substr(0,4); }
            if (incomeColumn < 0) throw std::runtime_error("No annual income column in workbook tab 16.");
            continue;
        }
        if (!localAuthority(cells[0]) || cells[1].empty()) continue;
        const auto value = number(cells[incomeColumn]);
        if (!value) continue;
        const auto name = normalized(cells[1]);
        const auto previous = result.values.find(name);
        if (previous != result.values.end() && previous->second != *value)
            throw std::runtime_error("Ambiguous income records for " + cells[1]);
        result.values[name] = *value;
    }
    if (incomeColumn < 0 || result.values.empty()) throw std::runtime_error("No local-authority income records in workbook tab 16.");
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
struct Feature { std::string code, name; std::optional<double> income; };
void properties(Writer& writer, const Feature& feature) {
    writer.StartObject(); key(writer,"authority_code"); text(writer,feature.code);
    key(writer,"authority_name"); text(writer,feature.name); key(writer,"income_per_head");
    if (feature.income) writer.Double(*feature.income); else writer.Null_();
    writer.EndObject();
}
void metadata(Writer& writer, const Income& income, unsigned matched, unsigned total) {
    writer.StartObject(); key(writer,"metric"); text(writer,"Gross disposable household income per head");
    key(writer,"source_year"); text(writer,income.year);
    key(writer,"elevation_range_m"); writer.StartArray(); writer.Int(0); writer.Int(1000); writer.EndArray();
    key(writer,"matched_authorities"); writer.Uint(matched);
    key(writer,"unmatched_authorities"); writer.Uint(total-matched);
    key(writer,"bounds"); writer.StartArray(); for (double bound : GridSpec{}.bounds) writer.Double(bound); writer.EndArray();
    key(writer,"method"); text(writer,"Smoothed inverse-distance interpolation of income samples; synthetic elevation, not geographic altitude");
    key(writer,"engine"); text(writer,"terrainDEM.cpp"); key(writer,"dem_backend"); text(writer,"RichDEM");
    key(writer,"data_pipeline"); text(writer,"dataPipeline.cpp"); writer.EndObject();
}
}

void writeIncome(std::ostream& out, const std::filesystem::path& sharedStrings, const std::filesystem::path& worksheet) {
    const auto income = readIncome(sharedStrings,worksheet);
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

void buildProduct(const std::filesystem::path& boundaries, const std::filesystem::path& sharedStrings,
                  const std::filesystem::path& worksheet, const std::filesystem::path& output,
                  const std::filesystem::path& context) {
    const auto income = readIncome(sharedStrings,worksheet);
    auto source = readChars(boundaries);
    rapidjson::Document document; document.ParseInsitu<0>(source.data());
    if (document.HasParseError()) throw std::runtime_error("Invalid planning-authority GeoJSON.");
    const auto& features = field(document,"features");
    if (!features.IsArray()) throw std::runtime_error("Expected a GeoJSON feature array.");
    std::vector<Feature> records;
    std::vector<Sample> samples;
    for (rapidjson::SizeType i = 0; i < features.Size(); ++i) {
        const auto& props = field(features[i],"properties");
        Feature record{stringField(props,"LPA26CD"),stringField(props,"LPA26NM"),std::nullopt};
        const auto match = income.values.find(normalized(record.name));
        if (match != income.values.end()) {
            record.income = match->second;
            samples.push_back({numericField(props,"LONG"),numericField(props,"LAT"),*record.income});
        }
        records.push_back(std::move(record));
    }
    if (samples.empty()) throw std::runtime_error("No boundaries match the income dataset.");
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
    out << "],\"dem\":"; writeDEM(out,GridSpec{},samples); out << ",\"metadata\":";
    Buffer meta; Writer metaWriter(meta,9); metadata(metaWriter,income,samples.size(),records.size());
    out << meta.GetString() << '}'; out.close();
    Buffer facts; Writer writer(facts,9);
    writer.StartObject(); key(writer,"metadata"); metadata(writer,income,samples.size(),records.size());
    key(writer,"authorities"); writer.StartObject();
    for (const auto& record : records) { text(writer,record.code); properties(writer,record); }
    writer.EndObject(); writer.EndObject();
    std::ofstream sidecar(context, std::ios::binary); sidecar.exceptions(std::ios::badbit | std::ios::failbit);
    sidecar << facts.GetString();
}
}
