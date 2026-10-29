import { describe, expect, it, vi, beforeEach } from "vitest";
import type { IExecuteFunctions, INodeExecutionData } from "n8n-workflow";

import { Hindsight } from "../nodes/Hindsight/Hindsight.node";

const API_URL = "https://api.example.com";

function createMockExecuteFunctions(
  params: Record<string, unknown>,
  options: {
    apiUrl?: string;
    apiKey?: string;
    requestImpl?: (...args: unknown[]) => unknown;
  } = {}
): IExecuteFunctions {
  const httpRequestWithAuthentication = vi.fn(options.requestImpl ?? (() => ({})));
  const fns = {
    getInputData: () => [{ json: {} }] as INodeExecutionData[],
    getCredentials: vi.fn().mockResolvedValue({
      apiUrl: options.apiUrl ?? API_URL,
      apiKey: options.apiKey ?? "hsk_test123",
    }),
    getNodeParameter: vi
      .fn()
      .mockImplementation((name: string, _index: number, fallback?: unknown) => {
        return params[name] ?? fallback;
      }),
    getNode: vi.fn().mockReturnValue({ name: "Hindsight" }),
    continueOnFail: vi.fn().mockReturnValue(false),
    helpers: {
      httpRequestWithAuthentication,
    },
  };
  return fns as unknown as IExecuteFunctions;
}

function getRequestMock(fns: IExecuteFunctions): ReturnType<typeof vi.fn> {
  return (fns as unknown as { helpers: { httpRequestWithAuthentication: ReturnType<typeof vi.fn> } })
    .helpers.httpRequestWithAuthentication;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("Hindsight node execute()", () => {
  const node = new Hindsight();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls retain endpoint with correct URL and body", async () => {
    const mockFns = createMockExecuteFunctions(
      {
        operation: "retain",
        bankId: "bank-1",
        content: "User prefers dark mode",
        retainTags: "pref,ui",
      },
      {
        requestImpl: () => ({ operation_id: "op-1", status: "accepted" }),
      }
    );

    const result = await node.execute.call(mockFns);

    const req = getRequestMock(mockFns);
    expect(req).toHaveBeenCalledTimes(1);
    expect(req).toHaveBeenCalledWith("hindsightApi", {
      method: "POST",
      url: `${API_URL}/v1/default/banks/bank-1/memories`,
      body: {
        items: [
          {
            content: "User prefers dark mode",
            tags: ["pref", "ui"],
            document_id: expect.any(String),
          },
        ],
      },
      json: true,
    });
    expect(result[0][0].json).toEqual({
      operation_id: "op-1",
      status: "accepted",
      document_id: expect.stringMatching(UUID_RE),
    });
  });

  it("retain generates a UUID document_id when none is provided and returns it", async () => {
    const mockFns = createMockExecuteFunctions(
      {
        operation: "retain",
        bankId: "bank-1",
        content: "Hello world",
        retainTags: "",
      },
      {
        requestImpl: () => ({ operation_id: "op-2", status: "accepted" }),
      }
    );

    const result = await node.execute.call(mockFns);

    const req = getRequestMock(mockFns);
    expect(req).toHaveBeenCalledWith("hindsightApi", {
      method: "POST",
      url: `${API_URL}/v1/default/banks/bank-1/memories`,
      body: { items: [{ content: "Hello world", document_id: expect.stringMatching(UUID_RE) }] },
      json: true,
    });
    const body = req.mock.calls[0][1].body as { items: { document_id: string }[] };
    expect(result[0][0].json.document_id).toBe(body.items[0].document_id);
  });

  it("retain includes document_id when provided", async () => {
    const mockFns = createMockExecuteFunctions(
      {
        operation: "retain",
        bankId: "bank-1",
        content: "Hello world",
        retainTags: "",
        retainDocumentId: "doc-1",
      },
      {
        requestImpl: () => ({ operation_id: "op-3", status: "accepted" }),
      }
    );

    const result = await node.execute.call(mockFns);

    const req = getRequestMock(mockFns);
    expect(req).toHaveBeenCalledWith("hindsightApi", {
      method: "POST",
      url: `${API_URL}/v1/default/banks/bank-1/memories`,
      body: { items: [{ content: "Hello world", document_id: "doc-1" }] },
      json: true,
    });
    expect(result[0][0].json).toEqual({
      operation_id: "op-3",
      status: "accepted",
      document_id: "doc-1",
    });
  });

  it("calls recall endpoint with correct URL and body", async () => {
    const mockFns = createMockExecuteFunctions(
      {
        operation: "recall",
        bankId: "bank-1",
        recallQuery: "what are user preferences?",
        recallBudget: "high",
        recallMaxTokens: 2048,
        recallTags: "pref",
      },
      {
        requestImpl: () => ({
          results: [{ text: "User prefers dark mode", score: 0.95 }],
        }),
      }
    );

    const result = await node.execute.call(mockFns);

    const req = getRequestMock(mockFns);
    expect(req).toHaveBeenCalledWith("hindsightApi", {
      method: "POST",
      url: `${API_URL}/v1/default/banks/bank-1/memories/recall`,
      body: {
        query: "what are user preferences?",
        max_tokens: 2048,
        budget: "high",
        tags: ["pref"],
      },
      json: true,
    });
    expect(result[0][0].json).toEqual({
      results: [{ text: "User prefers dark mode", score: 0.95 }],
    });
  });

  it("recall omits tags from body when tags filter is empty", async () => {
    const mockFns = createMockExecuteFunctions(
      {
        operation: "recall",
        bankId: "bank-1",
        recallQuery: "hello",
        recallBudget: "mid",
        recallMaxTokens: 4096,
        recallTags: "",
      },
      {
        requestImpl: () => ({ results: [] }),
      }
    );

    await node.execute.call(mockFns);

    const req = getRequestMock(mockFns);
    expect(req).toHaveBeenCalledWith("hindsightApi", {
      method: "POST",
      url: `${API_URL}/v1/default/banks/bank-1/memories/recall`,
      body: {
        query: "hello",
        max_tokens: 4096,
        budget: "mid",
      },
      json: true,
    });
  });

  it("calls reflect endpoint with correct URL and body", async () => {
    const mockFns = createMockExecuteFunctions(
      {
        operation: "reflect",
        bankId: "bank-1",
        reflectQuery: "summarize user preferences",
        reflectBudget: "low",
      },
      {
        requestImpl: () => ({
          text: "The user prefers dark mode and minimal UI.",
          citations: [],
        }),
      }
    );

    const result = await node.execute.call(mockFns);

    const req = getRequestMock(mockFns);
    expect(req).toHaveBeenCalledWith("hindsightApi", {
      method: "POST",
      url: `${API_URL}/v1/default/banks/bank-1/reflect`,
      body: {
        query: "summarize user preferences",
        budget: "low",
      },
      json: true,
    });
    expect(result[0][0].json).toEqual({
      text: "The user prefers dark mode and minimal UI.",
      citations: [],
    });
  });

  it("throws NodeOperationError when bankId is empty", async () => {
    const mockFns = createMockExecuteFunctions({
      operation: "retain",
      bankId: "",
      content: "test",
      retainTags: "",
    });

    await expect(node.execute.call(mockFns)).rejects.toThrow("bankId is required");
  });

  it("returns error json when continueOnFail is true and request throws", async () => {
    const mockFns = createMockExecuteFunctions(
      {
        operation: "retain",
        bankId: "bank-1",
        content: "test",
        retainTags: "",
      },
      {
        requestImpl: () => {
          throw new Error("Network error");
        },
      }
    );
    (mockFns.continueOnFail as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const result = await node.execute.call(mockFns);

    expect(result[0][0].json).toEqual({ error: "Network error" });
  });

  it("strips trailing slash from apiUrl when building request URL", async () => {
    const mockFns = createMockExecuteFunctions(
      {
        operation: "retain",
        bankId: "bank-1",
        content: "test",
        retainTags: "",
      },
      {
        apiUrl: "http://localhost:8888/",
        apiKey: "",
        requestImpl: () => ({ operation_id: "op-3", status: "accepted" }),
      }
    );

    await node.execute.call(mockFns);

    const req = getRequestMock(mockFns);
    expect(req).toHaveBeenCalledWith(
      "hindsightApi",
      expect.objectContaining({
        url: "http://localhost:8888/v1/default/banks/bank-1/memories",
      })
    );
  });
});
