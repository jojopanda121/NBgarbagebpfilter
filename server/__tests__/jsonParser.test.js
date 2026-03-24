const {
  sanitizeJsonString,
  attemptJsonFix,
  repairTruncatedJson,
  preprocessMinimaxOutput,
  extractJson,
  extractJsonArray,
  ensureStringArray,
} = require("../utils/jsonParser");

describe("sanitizeJsonString", () => {
  test("removes single-line comments", () => {
    const input = '{"key": "value"} // comment';
    const result = sanitizeJsonString(input);
    expect(JSON.parse(result)).toEqual({ key: "value" });
  });

  test("removes multi-line comments", () => {
    const input = '{"key": /* comment */ "value"}';
    const result = sanitizeJsonString(input);
    expect(JSON.parse(result)).toEqual({ key: "value" });
  });

  test("removes trailing commas", () => {
    const input = '{"a": 1, "b": 2, }';
    const result = sanitizeJsonString(input);
    expect(JSON.parse(result)).toEqual({ a: 1, b: 2 });
  });

  test("preserves URLs inside strings (does not strip //)", () => {
    const input = '{"url": "https://example.com/path"}';
    const result = sanitizeJsonString(input);
    expect(JSON.parse(result)).toEqual({ url: "https://example.com/path" });
  });

  test("preserves // inside string values while removing outside comments", () => {
    const input = '{"url": "https://example.com"} // this is a comment';
    const result = sanitizeJsonString(input);
    expect(JSON.parse(result)).toEqual({ url: "https://example.com" });
  });
});

describe("attemptJsonFix", () => {
  test("removes BOM and zero-width characters", () => {
    const input = '\uFEFF{"key": "value"}';
    const result = attemptJsonFix(input);
    expect(JSON.parse(result)).toEqual({ key: "value" });
  });

  test("removes trailing commas in arrays", () => {
    const input = '[1, 2, 3, ]';
    const result = attemptJsonFix(input);
    expect(JSON.parse(result)).toEqual([1, 2, 3]);
  });
});

describe("repairTruncatedJson", () => {
  test("closes unclosed braces", () => {
    const input = '{"key": {"nested": "value"';
    const result = repairTruncatedJson(input);
    expect(() => JSON.parse(result)).not.toThrow();
  });

  test("closes unclosed brackets", () => {
    const input = '[1, 2, [3, 4';
    const result = repairTruncatedJson(input);
    expect(() => JSON.parse(result)).not.toThrow();
  });

  test("closes unclosed strings", () => {
    const input = '{"key": "unclosed value';
    const result = repairTruncatedJson(input);
    expect(() => JSON.parse(result)).not.toThrow();
  });

  test("removes trailing comma before closing", () => {
    const input = '{"a": 1,';
    const result = repairTruncatedJson(input);
    expect(() => JSON.parse(result)).not.toThrow();
  });

  test("returns valid JSON unchanged", () => {
    const input = '{"key": "value"}';
    expect(repairTruncatedJson(input)).toBe(input);
  });
});

describe("preprocessMinimaxOutput", () => {
  test("removes minimax tool_call tags", () => {
    const input = 'some text <minimax:tool_call>call data</minimax:tool_call> more text';
    expect(preprocessMinimaxOutput(input)).toBe("some text  more text");
  });

  test("removes invoke tags", () => {
    const input = 'text <invoke name="test">body</invoke> end';
    expect(preprocessMinimaxOutput(input)).toBe("text  end");
  });

  test("handles null/undefined input", () => {
    expect(preprocessMinimaxOutput(null)).toBe(null);
    expect(preprocessMinimaxOutput(undefined)).toBe(undefined);
  });
});

describe("extractJson", () => {
  test("extracts JSON from markdown code block", () => {
    const input = 'Some text\n```json\n{"key": "value"}\n```\nMore text';
    expect(extractJson(input)).toEqual({ key: "value" });
  });

  test("extracts JSON from bare code block", () => {
    const input = '```\n{"key": "value"}\n```';
    expect(extractJson(input)).toEqual({ key: "value" });
  });

  test("extracts JSON from mixed text", () => {
    const input = 'Here is the result: {"score": 85, "grade": "A"} and some trailing text.';
    expect(extractJson(input)).toEqual({ score: 85, grade: "A" });
  });

  test("handles plain JSON", () => {
    expect(extractJson('{"a": 1}')).toEqual({ a: 1 });
  });

  test("handles truncated JSON", () => {
    const input = '{"key": "value", "nested": {"inner": "data"';
    const result = extractJson(input);
    expect(result).not.toBeNull();
    expect(result.key).toBe("value");
  });

  test("handles JSON with trailing commas", () => {
    const input = '{"a": 1, "b": 2, }';
    expect(extractJson(input)).toEqual({ a: 1, b: 2 });
  });

  test("returns null for empty input", () => {
    expect(extractJson("")).toBeNull();
    expect(extractJson(null)).toBeNull();
    expect(extractJson(undefined)).toBeNull();
  });

  test("returns null for non-JSON text", () => {
    expect(extractJson("just some plain text without any json")).toBeNull();
  });
});

describe("extractJsonArray", () => {
  test("extracts array from markdown code block", () => {
    const input = '```json\n[{"id": 1}, {"id": 2}]\n```';
    expect(extractJsonArray(input)).toEqual([{ id: 1 }, { id: 2 }]);
  });

  test("extracts array from text", () => {
    const input = 'Results: [1, 2, 3] end';
    expect(extractJsonArray(input)).toEqual([1, 2, 3]);
  });

  test("handles truncated array (may fail if repair insufficient)", () => {
    // Simple truncation with missing closing bracket/brace
    const input = '[{"a": 1}, {"b": 2}';
    const result = extractJsonArray(input);
    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(true);
  });

  test("returns null for empty input", () => {
    expect(extractJsonArray("")).toBeNull();
    expect(extractJsonArray(null)).toBeNull();
  });

  test("handles unclosed fenced code block", () => {
    const input = '```json\n[{"claim": "test"}]\n';
    const result = extractJsonArray(input);
    expect(result).not.toBeNull();
  });
});

describe("ensureStringArray", () => {
  test("passes through string arrays unchanged", () => {
    expect(ensureStringArray(["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  test("converts objects with description to strings", () => {
    const input = [{ description: "risk factor A" }];
    expect(ensureStringArray(input)).toEqual(["risk factor A"]);
  });

  test("converts objects without description using first string value", () => {
    const input = [{ name: "test", value: 42 }];
    expect(ensureStringArray(input)).toEqual(["test"]);
  });

  test("JSON stringifies objects with no string values", () => {
    const input = [{ a: 1, b: 2 }];
    const result = ensureStringArray(input);
    expect(result[0]).toBe('{"a":1,"b":2}');
  });

  test("returns empty array for non-array input", () => {
    expect(ensureStringArray(null)).toEqual([]);
    expect(ensureStringArray(undefined)).toEqual([]);
    expect(ensureStringArray("string")).toEqual([]);
    expect(ensureStringArray(42)).toEqual([]);
  });

  test("handles null/undefined elements", () => {
    const input = [null, undefined, "valid"];
    const result = ensureStringArray(input);
    expect(result).toEqual(["", "", "valid"]);
  });

  test("converts numbers to strings", () => {
    expect(ensureStringArray([1, 2, 3])).toEqual(["1", "2", "3"]);
  });
});
