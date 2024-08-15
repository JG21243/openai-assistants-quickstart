import { assistantId } from "@/app/assistant-config";
import { openai } from "@/app/openai";

// Exponential backoff function with enhanced retries and delay
async function withExponentialBackoff(fn, retries = 7, delay = 1500) {
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`Attempt ${i + 1} with delay ${delay}ms`);
      return await fn();
    } catch (error) {
      console.error(`Error on attempt ${i + 1}:`, error);
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

// Retrieve relevant files based on user's query
export async function GET(request) {
  try {
    console.log('GET request received for relevant files');

    const url = new URL(request.url);
    const userQuery = url.searchParams.get("query");
    console.log('User query:', userQuery);

    if (!userQuery) {
      console.error("Query parameter is missing.");
      return new Response("Query parameter is required", { status: 400 });
    }

    const vectorStoreId = await getOrCreateVectorStore();
    console.log('Vector Store ID:', vectorStoreId);

    // Ensure vector store is ready before querying
    await withExponentialBackoff(async () => {
      const vectorStore = await openai.beta.vectorStores.retrieve(vectorStoreId);
      if (vectorStore.file_counts.in_progress > 0) {
        console.warn("Vector store is still processing files.");
        throw new Error("Vector store is still processing files");
      }
    });

    console.log('Vector store is ready for use in the assistant.');
    return new Response("Vector store ready. Query will be handled by the assistant automatically.");
  } catch (error) {
    console.error("Error during GET request processing:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}

// Upload file to assistant's vector store
export async function POST(request) {
  try {
    console.log('POST request received');

    const formData = await request.formData();
    const file = formData.get("file");
    console.log('File received:', file.name);

    const vectorStoreId = await getOrCreateVectorStore();
    console.log('Vector Store ID:', vectorStoreId);

    await withExponentialBackoff(async () => {
      await openai.beta.vectorStores.files.createAndPoll(vectorStoreId, {
        file_id: file.id,
      });
    });

    console.log('File uploaded and processed in vector store');
    return new Response();
  } catch (error) {
    console.error("Error during POST request processing:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}

// Delete file from assistant's vector store
export async function DELETE(request) {
  try {
    console.log('DELETE request received');

    const body = await request.json();
    const fileId = body.fileId;
    console.log('File ID to delete:', fileId);

    const vectorStoreId = await getOrCreateVectorStore();
    console.log('Vector Store ID:', vectorStoreId);

    await withExponentialBackoff(() => openai.beta.vectorStores.files.del(vectorStoreId, fileId));
    console.log('File deleted from vector store:', fileId);

    return new Response();
  } catch (error) {
    console.error("Error during DELETE request processing:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}

/* Helper functions */

const getOrCreateVectorStore = async () => {
  try {
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
  } catch (error) {
    console.error("Error during vector store creation/retrieval:", error);
    throw error;
  }
};
