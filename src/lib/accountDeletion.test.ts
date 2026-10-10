import { describe, it, expect, vi } from "vitest";
import { accountDeletionUrl } from "./accountDeletion";

function answer(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe("[ACDL] account deletion URL", () => {
  it("[ACD1] DNS-style: the home core named by the register, not the user host", async () => {
    const fetchFn = answer(200, { server: "https://core-a.example.com/", alias: "alice.example.com" });
    const url = await accountDeletionUrl({
      register: "https://reg.example.com/",
      endpoint: "https://alice.example.com/",
      username: "alice",
      fetchFn,
    });
    expect(url).toBe("https://core-a.example.com/users/alice");
    expect(fetchFn).toHaveBeenCalledWith("https://reg.example.com/alice/server", expect.objectContaining({ method: "POST" }));
  });

  it("[ACD2] path-style: the register's core URL, and a register without a trailing slash", async () => {
    const fetchFn = answer(200, { server: "https://api.example.com/" });
    const url = await accountDeletionUrl({
      register: "https://api.example.com/reg",
      endpoint: "https://api.example.com/alice/",
      username: "alice",
      fetchFn,
    });
    expect(url).toBe("https://api.example.com/users/alice");
    expect(fetchFn).toHaveBeenCalledWith("https://api.example.com/reg/alice/server", expect.anything());
    // A core under a sub-path, answered without a trailing slash.
    expect(
      await accountDeletionUrl({
        register: "https://api.example.com/reg/",
        endpoint: "https://api.example.com/pryv/alice/",
        username: "alice",
        fetchFn: answer(200, { server: "https://api.example.com/pryv" }),
      }),
    ).toBe("https://api.example.com/pryv/users/alice");
  });

  it("[ACD3] lookup unavailable: the endpoint without its username segment", async () => {
    const endpoint = "https://api.example.com/alice/";
    for (const fetchFn of [
      answer(404, { error: { id: "unknown-user" } }),
      answer(200, { nothing: true }),
      answer(200, { server: "not a url" }),
      vi.fn(async () => { throw new TypeError("network"); }),
    ]) {
      expect(await accountDeletionUrl({ register: "https://reg.example.com/", endpoint, username: "alice", fetchFn })).toBe(
        "https://api.example.com/users/alice",
      );
    }
    const fetchFn = vi.fn();
    for (const register of [null, undefined, ""]) {
      expect(await accountDeletionUrl({ register, endpoint, username: "alice", fetchFn })).toBe(
        "https://api.example.com/users/alice",
      );
    }
    expect(fetchFn).not.toHaveBeenCalled();
    // A platform under a sub-path keeps it.
    expect(await accountDeletionUrl({ endpoint: "https://example.com/pryv/alice/", username: "alice" })).toBe(
      "https://example.com/pryv/users/alice",
    );
    // A DNS-style endpoint has no username segment to remove.
    expect(await accountDeletionUrl({ endpoint: "https://alice.example.com/", username: "alice" })).toBe(
      "https://alice.example.com/users/alice",
    );
  });

  it("[ACD4] the personal token is never sent over a downgraded protocol", async () => {
    const url = await accountDeletionUrl({
      register: "https://reg.example.com/",
      endpoint: "https://api.example.com/alice/",
      username: "alice",
      fetchFn: answer(200, { server: "http://core-a.example.com/" }),
    });
    expect(url).toBe("https://api.example.com/users/alice");
  });
});
