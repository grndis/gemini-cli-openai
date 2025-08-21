const express = require("express");
const { streamContent, geminiCliModels } = require("../services/gemini");

const router = express.Router();

/**
 * List available models
 */
router.get("/models", (req, res) => {
  const modelData = Object.keys(geminiCliModels).map((modelId) => ({
    id: modelId,
    object: "model",
    created: Math.floor(Date.now() / 1000),
    owned_by: "google-gemini-cli",
  }));

  res.json({
    object: "list",
    data: modelData,
  });
});

/**
 * Chat completions endpoint
 */
router.post("/chat/completions", async (req, res) => {
  try {
    const body = req.body;
    const model = body.model || "gemini-2.5-flash";
    const messages = body.messages || [];
    // OpenAI API compatibility: stream defaults to true unless explicitly set to false
    const stream = body.stream !== false;

    // Check environment settings for real thinking
    const isRealThinkingEnabled = process.env.ENABLE_REAL_THINKING === "true";
    let includeReasoning = isRealThinkingEnabled; // Automatically enable reasoning when real thinking is enabled
    let thinkingBudget = body.thinking_budget ?? -1; // Default to dynamic allocation

    // Newly added parameters
    const generationOptions = {
      max_tokens: body.max_tokens,
      temperature: body.temperature,
      top_p: body.top_p,
      stop: body.stop,
      presence_penalty: body.presence_penalty,
      frequency_penalty: body.frequency_penalty,
      seed: body.seed,
      response_format: body.response_format,
    };

    // Handle effort level mapping to thinking_budget
    const reasoning_effort =
      body.reasoning_effort ||
      body.extra_body?.reasoning_effort ||
      body.model_params?.reasoning_effort;
    if (reasoning_effort) {
      includeReasoning = true; // Effort implies reasoning
      const isFlashModel = model.includes("flash");
      switch (reasoning_effort) {
        case "low":
          thinkingBudget = 1024;
          break;
        case "medium":
          thinkingBudget = isFlashModel ? 12288 : 16384;
          break;
        case "high":
          thinkingBudget = isFlashModel ? 24576 : 32768;
          break;
        case "none":
          thinkingBudget = 0;
          includeReasoning = false;
          break;
      }
    }

    const tools = body.tools;
    const tool_choice = body.tool_choice;

    // Minimize verbose logging to match proxy format
    if (
      process.env.NODE_ENV !== "development" ||
      process.env.SHOW_DETAILED_LOGS === "true"
    ) {
      console.log(
        "\x1b[36m%s\x1b[0m",
        `Chat completion request received with ${messages.length} messages`,
      );
    }

    if (!messages.length) {
      return res.status(400).json({ error: "messages is a required field" });
    }

    // Validate model
    if (!(model in geminiCliModels)) {
      return res.status(400).json({
        error: `Model '${model}' not found. Available models: ${Object.keys(geminiCliModels).join(", ")}`,
      });
    }

    // Check if the request contains images and validate model support
    const hasImages = messages.some((msg) => {
      if (Array.isArray(msg.content)) {
        return msg.content.some((content) => content.type === "image_url");
      }
      return false;
    });

    if (hasImages && !geminiCliModels[model].supportsImages) {
      return res.status(400).json({
        error: `Model '${model}' does not support image inputs. Please use a vision-capable model like gemini-2.5-pro or gemini-2.5-flash.`,
      });
    }

    // Extract system prompt and user/assistant messages
    let systemPrompt = "";
    const otherMessages = messages.filter((msg) => {
      if (msg.role === "system") {
        // Handle system messages with both string and array content
        if (typeof msg.content === "string") {
          systemPrompt = msg.content;
        } else if (Array.isArray(msg.content)) {
          // For system messages, only extract text content
          const textContent = msg.content
            .filter((part) => part.type === "text")
            .map((part) => part.text || "")
            .join(" ");
          systemPrompt = textContent;
        }
        return false;
      }
      return true;
    });

    // Get account ID from request headers or use account rotation
    // If no specific account is requested, the gemini service will use account rotation
    const accountId = req.headers["x-gemini-account-id"] || null;

    if (stream) {
      // Streaming response
      res.set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      });

      const chatID = `chatcmpl-${Math.random().toString(36).substr(2, 9)}`;
      const creationTime = Math.floor(Date.now() / 1000);
      let firstChunk = true;

      try {
        // Show stream start
        console.log("\x1b[36mStarting stream generation\x1b[0m");
        const geminiStream = streamContent(model, systemPrompt, otherMessages, {
          ...(accountId && { accountId }), // Only include accountId if it's not null
          includeReasoning,
          thinkingBudget,
          tools,
          tool_choice,
          ...generationOptions,
        });

        let hasToolCall = false;

        for await (const chunk of geminiStream) {
          // For the first chunk, we need to set the role
          if (
            firstChunk &&
            (chunk.type === "text" || chunk.type === "thinking_content")
          ) {
            // We'll handle this in the format function
            firstChunk = false;
          }

          if (chunk.type === "tool_code") {
            hasToolCall = true;
          }

          const openAIChunk = formatOpenAIChunk(
            chunk,
            model,
            chatID,
            creationTime,
          );
          if (openAIChunk) {
            res.write(`data: ${JSON.stringify(openAIChunk)}\n\n`);
          }
        }

        // Send final chunk
        const finishReason = hasToolCall ? "tool_calls" : "stop";
        const finalChunk = formatOpenAIFinalChunk(
          model,
          chatID,
          creationTime,
          finishReason,
        );
        res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
        // Show stream completion
        console.log("\x1b[36mStream completed successfully\x1b[0m");
      } catch (streamError) {
        console.error("Stream error:", streamError);
        // Provide a generic error message to the client while logging the detailed error
        const errorMessage =
          process.env.NODE_ENV === "development"
            ? streamError.message
            : "Service temporarily unavailable. Please try again.";
        res.write(
          `data: ${JSON.stringify({ error: { message: errorMessage, type: "service_unavailable" } })}\n\n`,
        );
        res.write("data: [DONE]\n\n");
        res.end();
      }
    } else {
      // Non-streaming response
      try {
        // Show non-streaming start
        console.log("\x1b[36mStarting non-streaming completion\x1b[0m");
        let content = "";
        let usage = undefined;

        // Collect all chunks from the stream
        for await (const chunk of streamContent(
          model,
          systemPrompt,
          otherMessages,
          {
            ...(accountId && { accountId }), // Only include accountId if it's not null
            includeReasoning,
            thinkingBudget,
            tools,
            tool_choice,
            ...generationOptions,
          },
        )) {
          if (chunk.type === "text" && typeof chunk.data === "string") {
            content += chunk.data;
          } else if (chunk.type === "usage" && typeof chunk.data === "object") {
            usage = chunk.data;
          }
          // Skip reasoning chunks for non-streaming responses
        }

        const response = {
          id: `chatcmpl-${Math.random().toString(36).substr(2, 9)}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: model,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: content,
              },
              finish_reason: "stop",
            },
          ],
        };

        // Add usage information if available
        if (usage) {
          response.usage = {
            prompt_tokens: usage.inputTokens,
            completion_tokens: usage.outputTokens,
            total_tokens: usage.inputTokens + usage.outputTokens,
          };
        }

        // Show completion success
        console.log("\x1b[36mNon-streaming completion successful\x1b[0m");
        res.json(response);
      } catch (completionError) {
        console.error("Completion error:", completionError);
        // Provide a generic error message to the client while logging the detailed error
        const errorMessage =
          process.env.NODE_ENV === "development"
            ? completionError.message
            : "Service temporarily unavailable. Please try again.";
        res.status(500).json({
          error: { message: errorMessage, type: "service_unavailable" },
        });
      }
    }
  } catch (e) {
    console.error("Top-level error:", e);
    // Provide a generic error message to the client while logging the detailed error
    const errorMessage =
      process.env.NODE_ENV === "development"
        ? e.message
        : "Service temporarily unavailable. Please try again.";
    res
      .status(500)
      .json({ error: { message: errorMessage, type: "service_unavailable" } });
  }
});

/**
 * Format chunk to OpenAI format
 */
function formatOpenAIChunk(chunk, model, chatID, creationTime) {
  switch (chunk.type) {
    case "text":
    case "thinking_content":
      if (typeof chunk.data === "string") {
        return {
          id: chatID,
          object: "chat.completion.chunk",
          created: creationTime,
          model: model,
          choices: [
            {
              index: 0,
              delta: {
                content: chunk.data,
              },
              finish_reason: null,
            },
          ],
        };
      }
      break;
    case "real_thinking":
    case "reasoning":
      if (typeof chunk.data === "object" && chunk.data.reasoning) {
        return {
          id: chatID,
          object: "chat.completion.chunk",
          created: creationTime,
          model: model,
          choices: [
            {
              index: 0,
              delta: {
                reasoning: chunk.data.reasoning,
              },
              finish_reason: null,
            },
          ],
        };
      }
      break;
    case "tool_code":
      if (
        typeof chunk.data === "object" &&
        chunk.data.name &&
        chunk.data.args
      ) {
        const toolCallId = `call_${Math.random().toString(36).substr(2, 9)}`;
        return {
          id: chatID,
          object: "chat.completion.chunk",
          created: creationTime,
          model: model,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: toolCallId,
                    type: "function",
                    function: {
                      name: chunk.data.name,
                      arguments: JSON.stringify(chunk.data.args),
                    },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        };
      }
      break;
  }
  return null;
}

/**
 * Format final chunk to OpenAI format
 */
function formatOpenAIFinalChunk(
  model,
  chatID,
  creationTime,
  finishReason = "stop",
) {
  return {
    id: chatID,
    object: "chat.completion.chunk",
    created: creationTime,
    model: model,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: finishReason,
      },
    ],
  };
}

module.exports = { openaiRouter: router };
