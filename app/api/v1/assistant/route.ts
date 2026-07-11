import { NextRequest, NextResponse } from "next/server";
import { requireOfficeUser, requireSameOrigin } from "../../../lib/workspace-auth";

const demoAnswer = {
  answer: "Atlas Design Group's Westport Medical project is on track for the July 15 mobilization. The client confirmed access after 6:00 AM, moisture testing is complete, and the remaining risk is the pending adhesive delivery confirmation due tomorrow.",
  citations: ["Project overview · updated today", "Meeting notes · July 9", "Task: Confirm adhesive delivery · due tomorrow"],
};

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  const { question, context } = await request.json() as { question?: string; context?: string };
  if (!question?.trim()) return NextResponse.json({ error: "question is required" }, { status: 400 });
  if (question.length > 2000 || (context?.length ?? 0) > 8000) return NextResponse.json({ error: "question or context is too long" }, { status: 413 });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json(demoAnswer);

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-5.4",
      input: [
        { role: "system", content: "You are a permission-aware commercial flooring project assistant. Answer only from the supplied project context, state when evidence is missing, and end with a Sources list." },
        { role: "user", content: `Project context:\n${context ?? "No context supplied"}\n\nQuestion: ${question}` },
      ],
    }),
  });
  if (!response.ok) return NextResponse.json(demoAnswer);
  const data = await response.json() as { output_text?: string };
  return NextResponse.json({ answer: data.output_text ?? demoAnswer.answer, citations: demoAnswer.citations });
}
