import * as fs from 'fs';
import * as path from 'path';
import XLSX from 'xlsx';

const XLSX_FILE_NAME = 'CDESchoolDirectoryExport.xlsx';
const INPUT_XLSX_PATH = path.resolve(process.cwd(), XLSX_FILE_NAME);
const OUTPUT_DIR = path.resolve(process.cwd(), 'dist', 'pipeline', 'data');

function convertXlsxToCsv(): void {
    console.log(`Reading workbook: ${INPUT_XLSX_PATH}`);
    if (!fs.existsSync(INPUT_XLSX_PATH)) {
        console.error(`Error: Input file not found at ${INPUT_XLSX_PATH}`);
        process.exit(1);
    }

    try {
        const workbook = XLSX.readFile(INPUT_XLSX_PATH);

        if (!fs.existsSync(OUTPUT_DIR)) {
            console.log(`Creating output directory: ${OUTPUT_DIR}`);
            fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        }

        workbook.SheetNames.forEach((sheetName) => {
            const csvFilePath = path.join(OUTPUT_DIR, `${sheetName}.csv`);
            console.log(`Converting sheet "${sheetName}" to ${csvFilePath}...`);

            const worksheet = workbook.Sheets[sheetName];
            const csvData = XLSX.utils.sheet_to_csv(worksheet);

            fs.writeFileSync(csvFilePath, csvData);
            console.log(`Successfully wrote ${csvFilePath}`);
        });

        console.log('XLSX to CSV conversion complete.');
    } catch (error) {
        console.error('Error during XLSX conversion:', error);
        process.exit(1);
    }
}

convertXlsxToCsv(); 