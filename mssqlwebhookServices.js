const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");
const cheerio = require("cheerio");
const XLSX = require("xlsx");

async function extractTextFromCsv(content) {
    return content; // Process CSV content if needed
}

async function extractTextFromDocx(buffer) {
    const { value } = await mammoth.extractRawText({ buffer });
    return value;
}

async function extractTextFromPdf(buffer) {
    const data = await pdfParse(buffer);
    return data.text;
}

// XML Path Helper
function getValueFromXmlPath(obj, path) {
    const parts = path.split(".");
    let current = obj;
    for (const part of parts) {
        current = current[part];
        if (!current) return null;
    }
    return current.toString();
}

async function extractTextFromXml(content, paths = []) {
    const xml2js = require("xml2js");
    const parser = new xml2js.Parser();

    return new Promise((resolve, reject) => {
        parser.parseString(content, (err, result) => {
            if (err) {
                console.error("Error parsing XML:", err);
                return reject(err);
            }

            if (!paths || paths.length === 0) {
                resolve(JSON.stringify(result));
            } else {
                const extracted = paths
                    .map((path) => getValueFromXmlPath(result, path))
                    .filter(Boolean)
                    .join(" ");
                resolve(extracted);
            }
        });
    });
}

async function extractTextFromJson(content, properties = []) {
    try {
        const jsonData = JSON.parse(content);
        if (!properties || properties.length === 0) {
            return JSON.stringify(jsonData);
        }

        const extracted = properties.map((prop) => jsonData[prop] || "").join(" ");
        return extracted;
    } catch (err) {
        console.error("Error extracting JSON content:", err);
        return null;
    }
}

// Text Extraction Functions
async function extractTextFromTxt(content) {
    return content;
}

async function extractTextFromXlsx(buffer) {
    try {
        const workbook = XLSX.read(buffer, { type: "buffer" }); // Read the XLSX file buffer
        let textContent = '';

        workbook.SheetNames.forEach(sheetName => {
            const sheet = workbook.Sheets[sheetName]; // Access each sheet
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }); // Convert sheet to array of rows

            rows.forEach(row => {
                textContent += row.join(' ') + '\n'; // Combine columns into a single line and add a newline
            });
        });

        return textContent.trim(); // Return combined text content
    } catch (error) {
        console.error("Error extracting text from XLSX:", error);
        throw new Error("Failed to extract text from XLSX");
    }
}

async function extractTextFromHtml(htmlContent) {
    try {
        const $ = cheerio.load(htmlContent); // Load the HTML content
        return $('body').text().trim(); // Extract and return the text inside the <body> tag
    } catch (error) {
        console.error("Error extracting text from HTML:", error);
        throw new Error("Failed to extract text from HTML");
    }
}

async function processFieldContent(content, fieldType) {
    switch (fieldType.toUpperCase()) {
        case "TXT":
            return extractTextFromTxt(content);

        case "JSON":
            return extractTextFromJson(content);

        case "XML":
            return extractTextFromXml(content);

        case "HTML":
            return extractTextFromHtml(content);

        case "XLSX":
            return extractTextFromXlsx(Buffer.from(content, "binary"));

        case "PDF":
            return extractTextFromPdf(Buffer.from(content, "binary"));

        case "DOC":
        case "DOCX":
            return extractTextFromDocx(Buffer.from(content, "binary"));

        case "CSV":
            return extractTextFromCsv(content);

        default:
            console.log(`Unsupported field type: ${fieldType}`);
            return null;
    }
}

module.exports = {
    processFieldContent
}