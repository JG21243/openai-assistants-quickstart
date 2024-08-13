export let assistantId = "asst_OBLAKJDHrX5KyMLZCdJrveUY"; // set your assistant ID here

if (assistantId === "") {
  assistantId = process.env.OPENAI_ASSISTANT_ID;
}
