#include "dataPipeline.hpp"
#include "terrainDEM.hpp"
#include <iostream>
#include <stdexcept>
#include <string>

int main(int argc, char** argv) {
    std::ios::sync_with_stdio(false);
    try {
        if (argc == 1) terrain::readDEM(std::cin, std::cout);
        else if (argc == 10 && std::string(argv[1]) == "--build")
            terrain::buildProduct(argv[2], argv[3], argv[4], argv[5], argv[8], argv[9], argv[6], argv[7]);
        else if (argc == 8 && std::string(argv[1]) == "--history")
            terrain::buildHistory(argv[2], argv[3], argv[4], argv[5], argv[6], argv[7]);
        else if (argc == 8 && std::string(argv[1]) == "--build")
            terrain::buildProduct(argv[2], argv[3], argv[4], argv[5], argv[6], argv[7]);
        else if (argc == 4 && std::string(argv[1]) == "--income")
            terrain::writeIncome(std::cout, argv[2], argv[3]);
        else if (argc == 2 && std::string(argv[1]) == "--simplify")
            terrain::writeSimplifiedGeometry(std::cin, std::cout);
        else throw std::runtime_error("Use stdin DEM, --build boundary.json strings.xml income.xml density.xml output.json context.json, --income strings.xml sheet.xml, or --simplify with stdin geometry JSON.");
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
