import "@testing-library/jest-dom";

jest.mock("@vladmandic/human", () => {
  class MockHuman {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(_cfg?: unknown) {}
    async init() {
      /* no-op */
    }
    async load() {
      /* no-op */
    }
    async warmup() {
      /* no-op */
    }
    // Return an object that looks like Human.detect() output
    async detect(_input?: unknown) {
      return { face: [] };
    }
  }
  return {
    __esModule: true,
    default: MockHuman,
  };
});

jest.mock("./lib/supabase", () => { 
  const auth = {
    getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
    signInWithPassword: jest.fn().mockResolvedValue({
      data: { user: { id: "u1", email: "test@example.com" } },
      error: null,
    }),
    signUp: jest.fn().mockResolvedValue({
      data: { user: { id: "u1", email: "test@example.com" }, session: null },
      error: null,
    }),
    signOut: jest.fn().mockResolvedValue({ error: null }),
    getUser: jest.fn().mockResolvedValue({
      data: { user: { id: "u1", email: "test@example.com" } },
    }),
  };

  const from = (_table: string) => ({
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      }),
    }),
    upsert: jest.fn().mockResolvedValue({ data: null, error: null }),
  });

  const storage = {
    from: jest.fn().mockReturnValue({
      upload: jest.fn().mockResolvedValue({
        data: { path: "faces/test.jpg" },
        error: null,
      }),
    }),
  };

  const supabase = { auth, from, storage };
  return { __esModule: true, supabase };
});
