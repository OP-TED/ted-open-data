document.getElementById("queryForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const query = document.getElementById("query").value;
    const format = document.getElementById("format").value || "application/sparql-results+json";
    const endpoint = "http://publications.europa.eu/sparql"; // Replace with your endpoint if different

    try {
        const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: `query=${encodeURIComponent(query)}&format=${encodeURIComponent(format)}`
        });

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const result = await response.json(); // Assuming JSON format
        displayResults(result);
    } catch (error) {
        document.getElementById("results").textContent = `Error: ${error.message}`;
    }
});

// Function to display results
function displayResults(data) {
    const resultsDiv = document.getElementById("results");
    resultsDiv.innerHTML = ""; // Clear previous results

    if (data.results && data.results.bindings.length > 0) {
        const table = document.createElement("table");
        table.border = "1";

        // Create table headers
        const headers = Object.keys(data.results.bindings[0]);
        const thead = table.createTHead();
        const headerRow = thead.insertRow();
        headers.forEach((header) => {
            const th = document.createElement("th");
            th.textContent = header;
            headerRow.appendChild(th);
        });

        // Create table rows
        const tbody = table.createTBody();
        data.results.bindings.forEach((row) => {
            const tr = tbody.insertRow();
            headers.forEach((header) => {
                const td = tr.insertCell();
                td.textContent = row[header]?.value || "";
            });
        });

        resultsDiv.appendChild(table);
    } else {
        resultsDiv.textContent = "No results found.";
    }
}
