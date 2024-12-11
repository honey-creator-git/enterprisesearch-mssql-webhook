const cron = require("node-cron");
const { lastModifiedListener } = require("./lastModifiedListener"); // Use destructuring if using named export

// Schedule the cron job to run every 5 minutes
cron.schedule("*/5 * * * *", async () => {
    try {
        console.log("Executing MSSQL last modified listener job...");
        await lastModifiedListener();
        console.log("MSSQL last modified listener job executed successfully.");
    } catch (error) {
        console.error("Error executing MSSQL last modified listener job:", error.message);
    }
});

console.log("MSSQL Last Modified Listener is running...");
