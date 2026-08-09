import { MongoClient, ServerApiVersion } from "mongodb";

const fallbackUri = "mongodb://127.0.0.1:27017";
const configuredUri = process.env.MONGODB_URI?.trim();
const uri = configuredUri || fallbackUri;

const globalForMongo = globalThis as typeof globalThis & {
  sprintiaMongoClient?: MongoClient;
};

const client =
  globalForMongo.sprintiaMongoClient ??
  new MongoClient(uri, {
    maxPoolSize: 10,
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  });

if (process.env.NODE_ENV !== "production") {
  globalForMongo.sprintiaMongoClient = client;
}

export const databaseName = process.env.MONGODB_DB?.trim() || "sprintia";
export const isMongoConfigured = Boolean(configuredUri);

export function requireMongoConfiguration() {
  if (!isMongoConfigured) {
    throw new Error("Falta configurar MONGODB_URI para conectar Sprintia con MongoDB.");
  }
}

export async function appDatabase() {
  requireMongoConfiguration();
  await client.connect();
  return client.db(databaseName);
}

export default client;
