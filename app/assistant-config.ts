export let assistantId = "asst_DtoNM6FWkFB6uJHNrJUbpqaZ"; // set your assistant ID here

if (assistantId === "") {
  assistantId = process.env.OPENAI_ASSISTANT_ID;
}
