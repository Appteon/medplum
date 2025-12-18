// SPDX-License-Identifier: Apache-2.0
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });

export async function invokeLlama3({
  prompt,
  maxTokens = 512,
  temperature = 0.5,
  topP = 0.9,
}: {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
}): Promise<string> {
  const modelId = 'meta.llama3-70b-instruct-v1:0'; // Bedrock model ID for Llama 3.1 70B Instruct (128K context)

  // Format the prompt using Llama 3 instruction template
  // This prevents hallucination by properly structuring the input
  const formattedPrompt = `<|begin_of_text|><|start_header_id|>system<|end_header_id|>

You are an expert medical assistant. Follow the instructions carefully and provide accurate, concise responses based only on the information provided.<|eot_id|><|start_header_id|>user<|end_header_id|>

${prompt}<|eot_id|><|start_header_id|>assistant<|end_header_id|>

`;

  const body = {
    prompt: formattedPrompt,
    max_gen_len: maxTokens,
    temperature,
    top_p: topP,
  };

  const cmd = new InvokeModelCommand({
    modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(body),
  });

  const resp = await bedrockClient.send(cmd);
  const json = JSON.parse(new TextDecoder().decode(resp.body));
  const generation = json.generation || json.output || '';

  if (!generation || generation.trim() === '') {
    console.error('Bedrock returned empty generation:', JSON.stringify(json));
    throw new Error('Bedrock returned empty response');
  }

  return generation; // Llama3 returns { generation: "..." }
}
