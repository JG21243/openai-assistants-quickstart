import { assistantId } from "@/app/assistant-config";
import { openai } from "@/app/openai";

// Exponential backoff function with enhanced retries and delay
async function withExponentialBackoff(fn, retries = 7, delay = 1500) {
  for (let i = 0; i < retries; i++) {
    try {
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
  const formData = await request.formData();
  const file = formData.get("file");
  const vectorStoreId = await getOrCreateVectorStore();

  const openaiFile = await withExponentialBackoff(() => openai.files.create({
    file: file,
    purpose: "assistants",
  }));

  await withExponentialBackoff(() => openai.beta.vectorStores.files.create(vectorStoreId, {
    file_id: openaiFile.id,
  }));
  
  return new Response();
}

// list files in assistant's vector store
export async function GET() {
  const vectorStoreId = await getOrCreateVectorStore();
  const fileList = await withExponentialBackoff(() => openai.beta.vectorStores.files.list(vectorStoreId));

  const filesArray = await Promise.all(
    fileList.data.map(async (file) => {
      const fileDetails = await withExponentialBackoff(() => openai.files.retrieve(file.id));
      const vectorFileDetails = await withExponentialBackoff(() => openai.beta.vectorStores.files.retrieve(vectorStoreId, file.id));
      return {
        file_id: file.id,
        filename: fileDetails.filename,
        status: vectorFileDetails.status,
      };
    })
  );
  return Response.json(filesArray);
}

// delete file from assistant's vector store
export async function DELETE(request) {
  const body = await request.json();
  const fileId = body.fileId;
  const vectorStoreId = await getOrCreateVectorStore();

  await withExponentialBackoff(() => openai.beta.vectorStores.files.del(vectorStoreId, fileId));

  return new Response();
}

/* Helper functions */

const getOrCreateVectorStore = async () => {
  const assistant = await withExponentialBackoff(() => openai.beta.assistants.retrieve(assistantId));

  if (assistant.tool_resources?.file_search?.vector_store_ids?.length > 0) {
    return assistant.tool_resources.file_search.vector_store_ids[0];
  }

  const vectorStore = await withExponentialBackoff(() => openai.beta.vectorStores.create({
    name: "sample-assistant-vector-store",
  }));

  await withExponentialBackoff(() => openai.beta.assistants.update(assistantId, {
    tool_resources: {
      file_search: {
        vector_store_ids: [vectorStore.id],
      },
    },
  }));

  return vectorStore.id;
};
