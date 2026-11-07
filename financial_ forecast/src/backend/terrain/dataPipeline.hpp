#pragma once
#include <filesystem>
#include <iosfwd>

namespace terrain {
void buildProduct(const std::filesystem::path& boundaries,
                  const std::filesystem::path& sharedStrings,
                  const std::filesystem::path& worksheet,
                  const std::filesystem::path& output,
                  const std::filesystem::path& context);
void writeIncome(std::ostream& out, const std::filesystem::path& sharedStrings,
                 const std::filesystem::path& worksheet);
void writeSimplifiedGeometry(std::istream& input, std::ostream& out);
}
