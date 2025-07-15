#!/usr/bin/env node

/**
 * SurrealDB MCP Server
 * 
 * This MCP server provides a standardized interface for AI assistants to interact with a SurrealDB database.
 * It implements tools for common SurrealDB operations including:
 * - Executing raw SurrealQL queries
 * - Selecting, creating, updating, and deleting records
 * - Merging and patching data
 * - Upserting records
 * - Inserting multiple records
 * - Creating graph relations between records
 */

// Redirect console.log and console.error to ensure no logs go to stdout
console.log = (...args) => process.stderr.write(args.join(' ') + '\n');
console.error = (...args) => process.stderr.write(args.join(' ') + '\n');

// MCP SDK Imports
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListPromptsRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";

// SurrealDB Import
import { Surreal, RecordId } from "surrealdb"; // Import RecordId
import { inspect } from "util";

// Custom logger that writes to stderr to avoid interfering with JSON-RPC communication
const logger = {
  info: (...args: unknown[]) => {
    const timestamp = new Date().toISOString();
    process.stderr.write(`${timestamp} [surrealdb] [info] ${args.map(arg => typeof arg === 'string' ? arg : inspect(arg)).join(' ')}\n`);
  },
  error: (...args: unknown[]) => {
    const timestamp = new Date().toISOString();
    process.stderr.write(`${timestamp} [surrealdb] [error] ${args.map(arg => typeof arg === 'string' ? arg : inspect(arg)).join(' ')}\n`);
  }
};

// --- Database Configuration ---
// Read configuration from environment variables provided by MCP host
const DB_ENDPOINT = process.env.SURREALDB_URL;
const DB_NAMESPACE = process.env.SURREALDB_NS;
const DB_DATABASE = process.env.SURREALDB_DB;
const DB_USER = process.env.SURREALDB_USER;
const DB_PASS = process.env.SURREALDB_PASS;
// -----------------------------

// Validate that all required environment variables are set
if (!DB_ENDPOINT || !DB_NAMESPACE || !DB_DATABASE || !DB_USER || !DB_PASS) {
  logger.error(
    "FATAL ERROR: Missing one or more required SurrealDB environment variables (SURREALDB_URL, SURREALDB_NS, SURREALDB_DB, SURREALDB_USER, SURREALDB_PASS)"
  );
  process.exit(1);
}

// Instantiate the SurrealDB client
const db = new Surreal();

/**
 * Create an MCP server instance.
 * Capabilities will be added as tools are implemented.
 */
// Create server instance
const server = new Server(
  {
    name: "surrealdb-mcp-server",
    version: "0.1.10", // Updated to match current package version
  },
  {
    // Declare tool capability
    capabilities: {
      tools: {}, // This enables tool-related handlers like ListTools and CallTool
      resources: {}, // Add resources capability
      prompts: {}, // Add prompts capability
    },
  }
);

// --- MCP Request Handlers ---

// Handler for listing resources (required by MCP protocol)
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  logger.info("Handling ListResources request");
  return {
    resources: [], // Return empty array as we don't have any resources
  };
});

// Handler for listing resource templates (required by MCP protocol)
server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
  logger.info("Handling ListResourceTemplates request");
  return {
    resourceTemplates: [], // Return empty array as we don't have any resource templates
  };
});

// Handler for listing prompts (required by MCP protocol)
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  logger.info("Handling ListPrompts request");
  return {
    prompts: [], // Return an empty array as we don't have any prompts
  };
});

// Handler for listing available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  logger.info("Handling ListTools request");
  return {
    tools: [
      {
        name: "query",
        description:
          "Execute a raw SurrealQL query against the connected database.",
        inputSchema: {
          type: "object",
          properties: {
            query_string: {
              type: "string",
              description: "The SurrealQL query string to execute.",
            },
          },
          required: ["query_string"],
        },
      },
      {
        name: "select",
        description:
          "Select all records from a table or a specific record by ID.",
        inputSchema: {
          type: "object",
          properties: {
            table: {
              type: "string",
              description: "The name of the table to select from.",
            },
            id: {
              type: "string",
              description:
                "Optional: The specific ID of the record to select (e.g., 'user:john'). If omitted, selects all records.",
            },
          },
          required: ["table"],
        },
      },
      {
        name: "create",
        description: "Create a new record in a table with the specified data.",
        inputSchema: {
          type: "object",
          properties: {
            table: {
              type: "string",
              description: "The name of the table to create the record in.",
            },
            data: {
              type: "object",
              description: "An object containing the data for the new record.",
              additionalProperties: true, // Allow any properties in the data object
            },
          },
          required: ["table", "data"],
        },
      },
      {
        name: "update",
        description:
          "Update a specific record with new data. Replaces the entire record content.",
        inputSchema: {
          type: "object",
          properties: {
            thing: {
              type: "string",
              description: "The full record ID to update (e.g., 'table:id').",
            },
            data: {
              type: "object",
              description: "An object containing the new data for the record.",
              additionalProperties: true,
            },
          },
          required: ["thing", "data"],
        },
      },
      {
        name: "delete",
        description: "Delete a specific record by ID.",
        inputSchema: {
          type: "object",
          properties: {
            thing: {
              type: "string",
              description: "The full record ID to delete (e.g., 'table:id').",
            },
          },
          required: ["thing"],
        },
      },
      {
        name: "merge",
        description:
          "Merge data into a specific record. Only updates specified fields.",
        inputSchema: {
          type: "object",
          properties: {
            thing: {
              type: "string",
              description:
                "The full record ID to merge data into (e.g., 'table:id').",
            },
            data: {
              type: "object",
              description:
                "An object containing the data to merge into the record.",
              additionalProperties: true,
            },
          },
          required: ["thing", "data"],
        },
      },
      {
        name: "patch",
        description: "Apply JSON patches to a specific record.",
        inputSchema: {
          type: "object",
          properties: {
            thing: {
              type: "string",
              description: "The full record ID to patch (e.g., 'table:id').",
            },
            patches: {
              type: "array",
              description: "An array of JSON Patch operations (RFC 6902).",
              items: {
                type: "object",
                properties: {
                  op: {
                    type: "string",
                    enum: ["add", "remove", "replace", "move", "copy", "test"],
                  },
                  path: { type: "string" },
                  value: {
                    description: "Value for add, replace, test operations",
                  },
                  from: {
                    type: "string",
                    description: "Source path for move, copy operations",
                  },
                },
                required: ["op", "path"],
              },
            },
          },
          required: ["thing", "patches"],
        },
      },
      {
        name: "upsert",
        description:
          "Upsert a record: create if it doesn't exist, update if it does.",
        inputSchema: {
          type: "object",
          properties: {
            thing: {
              type: "string",
              description: "The full record ID to upsert (e.g., 'table:id').",
            },
            data: {
              type: "object",
              description: "An object containing the data for the record.",
              additionalProperties: true,
            },
          },
          required: ["thing", "data"],
        },
      },
      {
        name: "insert",
        description:
          "Insert multiple records into a table. Use 'create' for single records.",
        inputSchema: {
          type: "object",
          properties: {
            table: {
              type: "string",
              description: "The name of the table to insert records into.",
            },
            data: {
              type: "array",
              description:
                "An array of objects, each representing a record to insert.",
              items: {
                type: "object",
                additionalProperties: true,
              },
            },
          },
          required: ["table", "data"],
        },
      },
      {
        name: "insertRelation",
        description: "Create a graph relation (edge) between two records.",
        inputSchema: {
          type: "object",
          properties: {
            from_thing: {
              type: "string",
              description:
                "The full record ID of the 'from' record (e.g., 'user:john').",
            },
            relation_name: {
              type: "string",
              description:
                "The name of the relation/edge table (e.g., 'likes').",
            },
            to_thing: {
              type: "string",
              description:
                "The full record ID of the 'to' record (e.g., 'product:apple').",
            },
            data: {
              type: "object",
              description:
                "Optional: An object containing data for the relation itself.",
              additionalProperties: true,
            },
          },
          required: ["from_thing", "relation_name", "to_thing"],
        },
      },
    ],
  };
});

// Handler for executing tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    case "query": {
      // Validate input arguments
      const queryString = request.params.arguments?.query_string;
      if (typeof queryString !== "string" || !queryString.trim()) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Missing or invalid 'query_string' argument."
        );
      }

      try {
        logger.info(`Executing query tool with: ${queryString}`);
        // Execute the query using the globally connected db instance
        const result = await db.query(queryString);
        logger.info("Query executed successfully via tool.");

        // Return the result (SurrealDB returns an array of results per query)
        return {
          content: [
            {
              type: "text",
              // Convert result to JSON string for transport
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (e) {
        logger.error(`Error executing query tool:`, e); // Log full error object
        // Rethrow as an MCPError for the client
        throw new McpError(
          ErrorCode.InternalError,
          `SurrealDB query failed: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }

    case "select": {
      // Validate input arguments
      const table = request.params.arguments?.table;
      const id = request.params.arguments?.id; // Optional

      if (typeof table !== "string" || !table.trim()) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Missing or invalid 'table' argument."
        );
      }
      if (id !== undefined && (typeof id !== "string" || !id.trim())) {
        // Allow empty string ID? For now, require non-empty if provided.
        throw new McpError(
          ErrorCode.InvalidParams,
          "Invalid 'id' argument. Must be a non-empty string if provided."
        );
      }

      // Construct the 'thing' string for SurrealDB (e.g., 'user' or 'user:john')
      // Ensure ID is correctly formatted if it contains the table prefix already
      let thing: string;
      if (id) {
        // If ID already contains ':', assume it's fully qualified (e.g., 'table:id')
        // Otherwise, prepend the table name.
        thing = id.includes(":") ? id : `${table}:${id}`;
      } else {
        thing = table; // Select all from table
      }

      // Determine what to pass to db.select based on whether ID is present
      // If ID is present, create a RecordId instance.
      // If not, pass the table name string.
      let selectTarget: string | RecordId;
      if (id) {
        // Extract the ID part if the input 'id' is already 'table:id'
        const idPart = id.includes(":") ? id.split(":")[1] : id;
        selectTarget = new RecordId(table, idPart);
      } else {
        selectTarget = table;
      }

      try {
        // Log the type being passed to db.select
        logger.info(
          `Executing select tool for target: ${thing} (passing type: ${selectTarget.constructor.name}) using db.select`
        );
        // Execute the select using the globally connected db instance
        const result = await db.select(selectTarget);
        logger.info(`Select executed successfully for target: ${thing}.`);

        // Check if result is empty (record not found)
        const responseText =
          result && (!Array.isArray(result) || result.length > 0)
            ? JSON.stringify(result, null, 2)
            : "[]"; // Return empty array string if not found

        return {
          content: [
            {
              type: "text",
              text: responseText,
            },
          ],
        };
      } catch (e) {
        logger.error(`Error executing select tool for ${thing}:`, e); // Log full error object
        // Rethrow as an MCPError for the client
        throw new McpError(
          ErrorCode.InternalError,
          `SurrealDB select failed for ${thing}: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }

    case "create": {
      // Validate input arguments
      const table = request.params.arguments?.table;
      const data = request.params.arguments?.data;

      if (typeof table !== "string" || !table.trim()) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Missing or invalid 'table' argument."
        );
      }
      if (typeof data !== "object" || data === null || Array.isArray(data)) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Missing or invalid 'data' argument. Must be an object."
        );
      }

      try {
        logger.info(`Executing create tool for table: ${table}`);
        // Execute the create using the globally connected db instance
        // We pass the table name and the data object directly
        // Assert data type to satisfy TypeScript's index signature requirement
        const result = await db.create(
          table,
          data as { [key: string]: unknown }
        );
        logger.info(`Create executed successfully for table: ${table}.`);

        // Return the created record(s) (db.create returns an array)
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (e) {
        logger.error(`Error executing create tool for table ${table}:`, e); // Log full error object
        // Rethrow as an MCPError for the client
        throw new McpError(
          ErrorCode.InternalError,
          `SurrealDB create failed for table ${table}: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }

    case "update": {
      // Validate input arguments
      const thing = request.params.arguments?.thing;
      const data = request.params.arguments?.data;

      if (typeof thing !== "string" || !thing.includes(":")) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Missing or invalid 'thing' argument. Must be a full record ID (e.g., 'table:id')."
        );
      }
      if (typeof data !== "object" || data === null || Array.isArray(data)) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Missing or invalid 'data' argument. Must be an object."
        );
      }

      // Similar to db.select, db.update likely requires a RecordId instance
      // despite documentation examples showing a string.
      const [table, idPart] = thing.split(":");
      if (!table || !idPart) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Invalid 'thing' format. Must be 'table:id'."
        );
      }
      const recordId = new RecordId(table, idPart);

      try {
        logger.info(`Executing update tool for: ${thing} (using RecordId)`);
        // Execute the update using the globally connected db instance
        // Pass the RecordId instance and assert data type
        const result = await db.update(
          recordId,
          data as { [key: string]: unknown }
        );
        logger.info(`Update executed successfully for: ${thing}.`);

        // Return the updated record (db.update returns the updated record or array if multiple)
        // Note: The SDK documentation for update is slightly ambiguous on single vs array return,
        // but testing shows it returns the single updated object for a specific ID.
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (e) {
        logger.error(`Error executing update tool for ${thing}:`, e); // Log full error object
        // Rethrow as an MCPError for the client
        throw new McpError(
          ErrorCode.InternalError,
          `SurrealDB update failed for ${thing}: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }

    case "delete": {
      // Validate input arguments
      const thing = request.params.arguments?.thing;

      if (typeof thing !== "string" || !thing.includes(":")) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Missing or invalid 'thing' argument. Must be a full record ID (e.g., 'table:id')."
        );
      }

      // Assume db.delete also requires a RecordId instance based on select/update behavior
      const [table, idPart] = thing.split(":");
      if (!table || !idPart) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Invalid 'thing' format. Must be 'table:id'."
        );
      }
      const recordId = new RecordId(table, idPart);

      try {
        logger.info(`Executing delete tool for: ${thing} (using RecordId)`);
        // Execute the delete using the globally connected db instance
        // Pass the RecordId instance
        const result = await db.delete(recordId);
        logger.info(`Delete executed successfully for: ${thing}.`);

        // Check if result is empty (record might not have existed)
        // db.delete returns the deleted record(s) or potentially undefined/empty array if not found
        const responseText =
          result && (!Array.isArray(result) || result.length > 0)
            ? JSON.stringify(result, null, 2)
            : "Record not found or already deleted."; // Provide informative message

        return {
          content: [
            {
              type: "text",
              text: responseText,
            },
          ],
        };
      } catch (e) {
        logger.error(`Error executing delete tool for ${thing}:`, e); // Log full error object
        // Rethrow as an MCPError for the client
        throw new McpError(
          ErrorCode.InternalError,
          `SurrealDB delete failed for ${thing}: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }

    case "merge": {
      // Validate input arguments
      const thing = request.params.arguments?.thing;
      const data = request.params.arguments?.data;

      if (typeof thing !== "string" || !thing.includes(":")) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Missing or invalid 'thing' argument. Must be a full record ID (e.g., 'table:id')."
        );
      }
      if (typeof data !== "object" || data === null || Array.isArray(data)) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Missing or invalid 'data' argument. Must be an object."
        );
      }

      // db.merge likely requires a RecordId instance
      const [table, idPart] = thing.split(":");
      if (!table || !idPart) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Invalid 'thing' format. Must be 'table:id'."
        );
      }
      const recordId = new RecordId(table, idPart);

      try {
        logger.info(`Executing merge tool for: ${thing} (using RecordId)`);
        // Execute the merge using the globally connected db instance
        // Pass the RecordId instance and assert data type
        const result = await db.merge(
          recordId,
          data as { [key: string]: unknown }
        );
        logger.info(`Merge executed successfully for: ${thing}.`);

        // Return the merged record
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (e) {
        logger.error(`Error executing merge tool for ${thing}:`, e); // Log full error object
        // Rethrow as an MCPError for the client
        throw new McpError(
          ErrorCode.InternalError,
          `SurrealDB merge failed for ${thing}: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }

    case "patch": {
      // Validate input arguments
      const thing = request.params.arguments?.thing;
      const patches = request.params.arguments?.patches;

      if (typeof thing !== "string" || !thing.includes(":")) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Missing or invalid 'thing' argument. Must be a full record ID (e.g., 'table:id')."
        );
      }
      // Basic validation for patches array - could be more thorough
      if (!Array.isArray(patches) || patches.length === 0) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Missing or invalid 'patches' argument. Must be a non-empty array of patch operations."
        );
      }
      // Add more specific validation for each patch object if needed

      // db.patch likely requires a RecordId instance
      const [table, idPart] = thing.split(":");
      if (!table || !idPart) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Invalid 'thing' format. Must be 'table:id'."
        );
      }
      const recordId = new RecordId(table, idPart);

      try {
        logger.info(`Executing patch tool for: ${thing} (using RecordId)`);
        // Execute the patch using the globally connected db instance
        // Pass the RecordId instance and the patches array
        // Use a more generic type assertion to avoid compatibility issues
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await db.patch(recordId, patches as any);
        logger.info(`Patch executed successfully for: ${thing}.`);

        // Return the patched record
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (e) {
        logger.error(`Error executing patch tool for ${thing}:`, e); // Log full error object
        // Rethrow as an MCPError for the client
        throw new McpError(
          ErrorCode.InternalError,
          `SurrealDB patch failed for ${thing}: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }

    case "upsert": {
      // Validate input arguments
      const thing = request.params.arguments?.thing;
      const data = request.params.arguments?.data;

      if (typeof thing !== "string" || !thing.includes(":")) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Missing or invalid 'thing' argument. Must be a full record ID (e.g., 'table:id')."
        );
      }
      if (typeof data !== "object" || data === null || Array.isArray(data)) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Missing or invalid 'data' argument. Must be an object."
        );
      }

      // db.upsert likely requires a RecordId instance
      const [table, idPart] = thing.split(":");
      if (!table || !idPart) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Invalid 'thing' format. Must be 'table:id'."
        );
      }
      const recordId = new RecordId(table, idPart);

      try {
        logger.info(`Executing upsert tool for: ${thing} (using RecordId)`);
        // Execute the upsert using the globally connected db instance
        // Pass the RecordId instance and assert data type
        const result = await db.upsert(
          recordId,
          data as { [key: string]: unknown }
        );
        logger.info(`Upsert executed successfully for: ${thing}.`);

        // Return the upserted record
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (e) {
        logger.error(`Error executing upsert tool for ${thing}:`, e); // Log full error object
        // Rethrow as an MCPError for the client
        throw new McpError(
          ErrorCode.InternalError,
          `SurrealDB upsert failed for ${thing}: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }

    case "insert": {
      // Validate input arguments
      const table = request.params.arguments?.table;
      const data = request.params.arguments?.data;

      if (typeof table !== "string" || !table.trim()) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Missing or invalid 'table' argument."
        );
      }
      if (
        !Array.isArray(data) ||
        data.length === 0 ||
        !data.every((item) => typeof item === "object" && item !== null)
      ) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Missing or invalid 'data' argument. Must be a non-empty array of objects."
        );
      }

      try {
        logger.info(
          `Executing insert tool for table: ${table} with ${data.length} records`
        );
        // Execute the insert using the globally connected db instance
        // Pass the table name and the array of data objects
        const result = await db.insert(
          table,
          data as { [key: string]: unknown }[]
        );
        logger.info(`Insert executed successfully for table: ${table}.`);

        // Return the inserted records (db.insert returns an array)
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (e) {
        logger.error(`Error executing insert tool for table ${table}:`, e); // Log full error object
        // Rethrow as an MCPError for the client
        throw new McpError(
          ErrorCode.InternalError,
          `SurrealDB insert failed for table ${table}: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }

    case "insertRelation": {
      // Validate input arguments
      const fromThing = request.params.arguments?.from_thing;
      const relationName = request.params.arguments?.relation_name;
      const toThing = request.params.arguments?.to_thing;
      const data = request.params.arguments?.data; // Optional

      if (typeof fromThing !== "string" || !fromThing.includes(":")) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Missing or invalid 'from_thing' argument. Must be a full record ID (e.g., 'table:id')."
        );
      }
      if (typeof relationName !== "string" || !relationName.trim()) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Missing or invalid 'relation_name' argument."
        );
      }
      if (typeof toThing !== "string" || !toThing.includes(":")) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Missing or invalid 'to_thing' argument. Must be a full record ID (e.g., 'table:id')."
        );
      }
      if (
        data !== undefined &&
        (typeof data !== "object" || data === null || Array.isArray(data))
      ) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Invalid 'data' argument. Must be an object if provided."
        );
      }

      // Parse record IDs
      const [fromTable, fromIdPart] = fromThing.split(":");
      const [toTable, toIdPart] = toThing.split(":");
      if (!fromTable || !fromIdPart || !toTable || !toIdPart) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Invalid 'from_thing' or 'to_thing' format. Must be 'table:id'."
        );
      }
      const fromRecordId = new RecordId(fromTable, fromIdPart);
      const toRecordId = new RecordId(toTable, toIdPart);

      // Construct the data object for the relation record
      const relationData = {
        in: fromRecordId,
        out: toRecordId,
        ...(data as { [key: string]: unknown } | undefined), // Spread optional data
      };

      try {
        logger.info(
          `Executing insertRelation tool: ${fromThing} -> ${relationName} -> ${toThing}`
        );
        // Execute the insertRelation using the globally connected db instance
        // Pass the relation table name and the constructed data object
        const result = await db.insertRelation(relationName, relationData);
        logger.info(`insertRelation executed successfully.`);

        // Return the created relation record(s) (db.insertRelation returns an array)
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (e) {
        logger.error(
          `Error executing insertRelation tool (${fromThing} -> ${relationName} -> ${toThing}):`,
          e
        ); // Log full error object
        // Rethrow as an MCPError for the client
        throw new McpError(
          ErrorCode.InternalError,
          `SurrealDB insertRelation failed: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }

    default:
      // Use McpError for unknown tools
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Unknown tool: ${request.params.name}`
      );
  }
});

// --------------------------

/**
 * Main function to start the server.
 * Connects to SurrealDB first, then starts the MCP server transport.
 */
async function main() {
  try {
    // Log connection attempt with more details
    logger.info(`Attempting to connect to SurrealDB at ${DB_ENDPOINT}...`);
    logger.info(`Using namespace: ${DB_NAMESPACE}, database: ${DB_DATABASE}, user: ${DB_USER}`);
    logger.info(`Password length: ${DB_PASS?.length || 0} characters`);
    
    // Connect to SurrealDB using environment variables
    await db.connect(DB_ENDPOINT!, {
      namespace: DB_NAMESPACE!,
      database: DB_DATABASE!,
      auth: {
        username: DB_USER!,
        password: DB_PASS!,
      },
    });
    
    // Connection and authentication successful
    logger.info("✅ SurrealDB connection and authentication successful!");
    
    logger.info(
      `Successfully connected to SurrealDB (NS: ${DB_NAMESPACE}, DB: ${DB_DATABASE})`
    );

    // Start the MCP server communication
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info("SurrealDB MCP Server connected via stdio transport.");
  } catch (error) {
    logger.error("--- FATAL ERROR ---");
    if (error instanceof Error) {
      logger.error("Failed to connect to SurrealDB or start MCP server:", error.message);
      logger.error("Error name:", error.name);
      logger.error("Full error:", error);
      logger.error(error.stack || "No stack trace available");
    } else {
      logger.error("An unknown error occurred during startup:", error);
    }
    logger.error("Connection details (sanitized):");
    logger.error(`URL: ${DB_ENDPOINT}`);
    logger.error(`Namespace: ${DB_NAMESPACE}`);
    logger.error(`Database: ${DB_DATABASE}`);
    logger.error(`User: ${DB_USER}`);
    logger.error("-------------------");
    await db.close();
    process.exit(1);
  }
}

// Graceful shutdown
process.on("SIGINT", async () => {
  logger.info("\nCaught interrupt signal (Ctrl+C).");
  logger.info("Closing SurrealDB connection...");
  await db.close();
  logger.info("Database connection closed.");
  logger.info("Shutting down MCP server...");
  await server.close(); // Close the MCP server itself
  logger.info("MCP server shut down.");
  process.exit(0);
});

// Start the main application logic
main().catch((error) => {
  // This catch is mainly for unexpected errors not caught within main's try/catch
  logger.error("Unhandled error in main execution:", error);
  process.exit(1);
});
