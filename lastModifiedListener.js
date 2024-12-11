const sql = require("mssql");
const axios = require("axios");
const esClient = require("./elasticsearch");
const processFieldContent = require("./mssqlwebhookServices").processFieldContent;

async function fetchIndicesWithPrefix(prefix) {
    try {
        const result = await esClient.cat.indices({ format: "json" });
        const indices = result.filter((index) => index.index.startsWith(prefix));
        return indices.map((index) => index.index);
    } catch (error) {
        console.error("Error fetching indices from Elasticsearch:", error.message);
        throw new Error("Failed to fetch indices from Elasticsearch");
    }
}

async function fetchIndexDetails(indexName) {
    try {
        const result = await esClient.search({
            index: indexName,
            body: {
                query: {
                    match_all: {},
                },
            },
        });

        return result.hits.hits.map((hit) => ({
            source: hit._source,
            id: hit._id,
        }));
    } catch (error) {
        console.error(`Error fetching details from index ${indexName}:`, error.message);
        throw new Error("Failed to fetch index details from Elasticsearch");
    }
}

const updateTimeInElasticsearch = async (indexName, docId, updatedAt) => {
    try {
        await esClient.update({
            index: indexName,
            id: docId,
            body: {
                doc: {
                    updatedAt: updatedAt, // Ensure this is ISO format
                },
            },
        });
        console.log(`Updated updatedAt for docId ${docId} in index ${indexName}`);
    } catch (error) {
        console.error(`Error updating updatedAt in Elasticsearch for docId ${docId}:`, error.message);
        throw new Error("Failed to update updatedAt in Elasticsearch");
    }
};

async function fetchUpdatedRows(config) {
    const dbConfig = {
        user: config.source.user,
        password: config.source.password,
        server: config.source.host,
        database: config.source.database,
        options: {
            encrypt: true,
            trustServerCertificate: false,
        },
    };

    const connection = await sql.connect(dbConfig);

    try {

        console.log("Current updatedAt in Elasticsearch:", config.source.updatedAt);

        const query = `
            SELECT RowID, ChangeTime, NewValue AS ${config.source.field_name}, ActionType
            FROM ${config.source.table_name}_ChangeLog
            WHERE ChangeTime > @LastIndexedTime
            ORDER BY ChangeTime ASC
        `;

        const lastIndexedTime = new Date(config.source.updatedAt || 0);

        const result = await connection.request()
            .input("LastIndexedTime", sql.DateTime, lastIndexedTime)
            .query(query);

        if (result.recordset.length > 0) {
            const latestChangeTime = result.recordset[result.recordset.length - 1].ChangeTime;

            console.log("Updating Elasticsearch with:", latestChangeTime.toISOString());

            await updateTimeInElasticsearch(`datasource_mssql_connection_${config.source.coid.toLowerCase()}`, config.id, latestChangeTime.toISOString());
        }

        return result.recordset;
    } catch (error) {
        console.error("Error fetching updated rows:", error.message);
        throw error;
    } finally {
        await connection.close();
    }
}

async function processAndIndexData(rows, fieldName, fieldType, indexName) {
    const documents = [];

    for (const row of rows) {
        try {
            const content = await processFieldContent(row[fieldName], fieldType);

            if (content) {
                console.log("Row Action Type => ", row.ActionType);
                documents.push({
                    "@search.action": row.ActionType === "INSERT" ? "upload" : "mergeOrUpload",
                    id: row.RowID.toString(),
                    content, // Processed content
                });
            }
        } catch (error) {
            console.error(`Error processing content for row ID ${row.RowID}:`, error.message);
        }
    }

    if (documents.length > 0) {
        await pushToAzureSearch(documents, indexName);
        console.log(`Indexed ${documents.length} documents.`);
    } else {
        console.log("No documents to index.");
    }
}

async function pushToAzureSearch(documents, indexName) {
    try {
        const response = await axios.post(
            `${process.env.AZURE_SEARCH_ENDPOINT}/indexes/${indexName}/docs/index?api-version=2021-04-30-Preview`,
            { value: documents },
            {
                headers: {
                    "Content-Type": "application/json",
                    "api-key": process.env.AZURE_SEARCH_API_KEY,
                },
            }
        );

        console.log("Data pushed to Azure Search successfully.");
        return response.data;
    } catch (error) {
        console.error("Failed to push data to Azure Search:", error.message);
        throw new Error("Azure Search push failed.");
    }
}

async function processIndices(indices) {
    for (const indexName of indices) {
        try {
            const indexDetails = await fetchIndexDetails(indexName);

            for (const config of indexDetails) {
                try {
                    const updatedRows = await fetchUpdatedRows(config);
                    if (updatedRows.length > 0) {
                        await processAndIndexData(updatedRows, config.source.field_name, config.source.field_type, `tenant_${config.source.coid.toLowerCase()}`);
                    }
                } catch (error) {
                    console.error(`Error processing table: ${config.source.table_name}, field: ${config.source.field_name}`, error.message);
                }
            }
        } catch (error) {
            console.error(`Error processing index: ${indexName}`, error.message);
        }
    }
}

exports.lastModifiedListener = async () => {
    try {
        console.log("Fetching indices with prefix...");
        const indices = await fetchIndicesWithPrefix("datasource_mssql_connection_");

        if (indices.length > 0) {
            await processIndices(indices);
        } else {
            console.log("No indices found with the specified prefix.");
        }
    } catch (error) {
        console.error("Error during periodic indexing:", error.message);
    }
};
