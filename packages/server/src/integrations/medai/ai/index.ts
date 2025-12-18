// SPDX-License-Identifier: Apache-2.0
// AI Service barrel export
export { invokeLlama3 } from './bedrock.js';
export {
  generateAIScribeNotes,
  generateSmartSynthesisNote,
  generatePreChartNote,
  generateSOAPFromTranscript,
  generateScribedSummary,
  type BaseAIResult,
  type SmartSynthesisContext,
  type PreChartContext,
} from './medical-llm.js';
