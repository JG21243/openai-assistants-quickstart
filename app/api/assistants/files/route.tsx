import { assistantId } from "@/app/assistant-config";
import { openai } from "@/app/openai";

// Exponential backoff function with enhanced retries and delay
async function withExponentialBackoff(fn, retries = 7, delay = 1500) {
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`Attempt ${i + 1} with delay ${delay}ms`);
      return await fn();
    } catch (error) {
      if (error.status === 429 && i < retries - 1) {
        console.warn(`Rate limit exceeded. Retrying in ${delay}ms... (Attempt ${i + 1})`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2; // Exponential backoff
      } else {
        console.error(`Request failed after ${i + 1} attempts:`, error);
        throw error;
      }
    }
  }
}

// Query the vector store and get details of relevant files based on the user's question
export async function GET(request) {
  console.log('GET request received for relevant files');

  // Extract user's query from the request (assuming it's passed in as a query parameter)
  const url = new URL(request.url);
  const userQuery = url.searchParams.get("query");

  if (!userQuery) {
    return new Response("Query parameter is required", { status: 400 });
  }

  // Query vector store for relevant files based on the user's question
  const vectorStoreId = await getOrCreateVectorStore();
  const relevantFiles = await withExponentialBackoff(() => openai.beta.vectorStores.search({
    vectorStoreId: vectorStoreId,
    query: userQuery,
    limit: 2, // Limit to top 2 relevant files
  }));

  console.log('Relevant files found:', relevantFiles.length);

  // Fetch details for only the relevant files
  const filesArray = await Promise.all(
    relevantFiles.map(async (file) => {
      const fileDetails = await withExponentialBackoff(() => openai.files.retrieve(file.id));
      return {
        file_id: file.id,
        filename: fileDetails.filename,
        status: fileDetails.status,
      };
    })
  );

  console.log('Relevant files processed:', filesArray.length);
  return Response.json(filesArray);
}

// upload file to assistant's vector store
export async function POST(request) {
  console.log('POST request received');
  const formData = await request.formData();
  const file = formData.get("file");
  console.log('File received:', file.name);

  const vectorStoreId = await getOrCreateVectorStore();
  console.log('Vector Store ID:', vectorStoreId);

  const openaiFile = await withExponentialBackoff(() => openai.files.create({
    file: file,
    purpose: "assistants",
  }));
  console.log('File uploaded to OpenAI:', openaiFile.id);

  await withExponentialBackoff(() => openai.beta.vectorStores.files.create(vectorStoreId, {
    file_id: openaiFile.id,
  }));
  console.log('File associated with vector store');

  return new Response();
}

// delete file from assistant's vector store
export async function DELETE(request) {
  console.log('DELETE request received');
  const body = await request.json();
  const fileId = body.fileId;
  console.log('File ID to delete:', fileId);

  const vectorStoreId = await getOrCreateVectorStore();
  console.log('Vector Store ID:', vectorStoreId);

  await withExponentialBackoff(() => openai.beta.vectorStores.files.del(vectorStoreId, fileId));
  console.log('File deleted from vector store:', fileId);

  return new Response();
}

/* Helper functions */

const getOrCreateVectorStore = async () => {
  console.log('Retrieving or creating vector store');
  const assistant = await withExponentialBackoff(() => openai.beta.assistants.retrieve(assistantId));
  console.log('Assistant retrieved:', assistant.id);

  if (assistant.tool_resources?.file_search?.vector_store_ids?.length > 0) {
    console.log('Existing vector store found');
    return assistant.tool_resources.file_search.vector_store_ids[0];
  }

  console.log('Creating new vector store');
  const vectorStore = await withExponentialBackoff(() => openai.beta.vectorStores.create({
    name: "sample-assistant-vector-store",
  }));
  console.log('New vector store created:', vectorStore.id);

  await withExponentialBackoff(() => openai.beta.assistants.update(assistantId, {
    tool_resources: {
      file_search: {
        vector_store_ids: [vectorStore.id],
      },
    },
  }));
  console.log('Vector store associated with assistant');

  return vectorStore.id;
};
