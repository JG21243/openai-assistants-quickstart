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

// list files in assistant's vector store
export async function GET() {
  console.log('GET request received');
  const vectorStoreId = await getOrCreateVectorStore();
  console.log('Vector Store ID:', vectorStoreId);

  const fileList = await withExponentialBackoff(() => openai.beta.vectorStores.files.list(vectorStoreId));
  console.log('Files listed in vector store:', fileList.data.length);

  const filesArray = await Promise.all(
    fileList.data.map(async (file) => {
      console.log('Processing file:', file.id);
      const fileDetails = await withExponentialBackoff(() => openai.files.retrieve(file.id));
      const vectorFileDetails = await withExponentialBackoff(() => openai.beta.vectorStores.files.retrieve(vectorStoreId, file.id));
      console.log('File details retrieved:', fileDetails.filename);
      return {
        file_id: file.id,
        filename: fileDetails.filename,
        status: vectorFileDetails.status,
      };
    })
  );
  console.log('Files processed:', filesArray.length);

  return Response.json(filesArray);
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
