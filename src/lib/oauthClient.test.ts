import { describe, it, expect } from "vitest";
import { accessNaming, entryNaming, foldOAuthSessions, oauthClientOf, oauthClientIdOf, oauthGrantIdOf } from "./oauthClient";

const META = { name: "Agent", host: "client.example", url: "https://client.example/c.json" };

describe("[OACN] OAuth access naming", () => {
  it("[OACN1] reads the client stamp: a metadata-document client, an operator-registered one, none", () => {
    expect(oauthClientOf({ clientData: { oauth: { client: META } } })).toEqual({ kind: "metadata-document", name: "Agent", host: "client.example" });
    expect(oauthClientOf({ clientData: { oauth: { client: { host: "client.example", url: META.url } } } })).toEqual({ kind: "metadata-document", host: "client.example" });
    expect(oauthClientOf({ clientData: { oauth: { client: { ...META, origin: "metadata-document" } } } })).toEqual({ kind: "metadata-document", name: "Agent", host: "client.example" });
    // A host always wins: a metadata-document name is never read as operator-registered.
    expect(oauthClientOf({ clientData: { oauth: { client: { ...META, origin: "operator" } } } })).toEqual({ kind: "metadata-document", name: "Agent", host: "client.example" });
    expect(oauthClientOf({ clientData: { oauth: { client: { name: "Clinic app", origin: "operator" } } } })).toEqual({ kind: "operator", name: "Clinic app" });
    expect(oauthClientOf({ clientData: { oauth: { client: { origin: "operator" } } } })).toEqual({ kind: "operator" });
    // A stamp of no known shape, or none, reads as unstamped.
    expect(oauthClientOf({ clientData: { oauth: { client: { name: "Forged" } } } })).toBeNull();
    expect(oauthClientOf({ clientData: { oauth: { dataGrantId: "g1" } } })).toBeNull();
    expect(oauthClientOf({ clientData: null })).toBeNull();
    expect(oauthClientOf(null)).toBeNull();
  });

  it("[OACN2] the client id and the grant of an OAuth access", () => {
    expect(oauthClientIdOf({ name: "oauth-grant:clinic" })).toBe("clinic");
    expect(oauthClientIdOf({ name: "oauth:clinic" })).toBe("clinic");
    expect(oauthClientIdOf({ name: "diary-app" })).toBeNull();
    expect(oauthClientIdOf({ name: "oauth:" })).toBeNull();
    expect(oauthGrantIdOf({ clientData: { oauth: { dataGrantId: "g1:3" } } })).toBe("g1");
    expect(oauthGrantIdOf({ clientData: { oauth: {} } })).toBeNull();
  });

  it("[OACN3] the name to show: the stamp's (host beside a metadata-document client's), else the client id, else the access name", () => {
    expect(accessNaming({ name: "oauth-grant:url~abc", clientData: { oauth: { client: META } } })).toEqual({ label: "Agent", host: "client.example" });
    expect(accessNaming({ name: "oauth-grant:url~abc", clientData: { oauth: { client: { host: "client.example", url: META.url } } } })).toEqual({ label: "client.example" });
    expect(accessNaming({ name: "oauth-grant:clinic", clientData: { oauth: { client: { name: "Clinic app", origin: "operator" } } } })).toEqual({ label: "Clinic app" });
    expect(accessNaming({ name: "oauth-grant:clinic", clientData: { oauth: { client: { origin: "operator" } } } })).toEqual({ label: "clinic" });
    expect(accessNaming({ name: "oauth:clinic" })).toEqual({ label: "clinic" });
    // A metadata-document client's row key is no name.
    expect(accessNaming({ name: "oauth-grant:url~abc" })).toEqual({ label: "oauth-grant:url~abc" });
    expect(accessNaming({ name: "diary-app" })).toEqual({ label: "diary-app" });
  });

  it("[OACN4] folds each session under its listed grant; a session without a listed grant stays an entry", () => {
    const grant = { id: "g1:2", name: "oauth-grant:clinic" };
    const s1 = { id: "s1", name: "oauth:clinic", clientData: { oauth: { dataGrantId: "g1" } } };
    const s2 = { id: "s2", name: "oauth:clinic", clientData: { oauth: { dataGrantId: "g1" } } };
    const orphan = { id: "s3", name: "oauth:other", clientData: { oauth: { dataGrantId: "gone" } } };
    const app = { id: "a1", name: "diary-app" };
    // An access the app's session created and a resource server's derived session name the grant too: not folded.
    const created = { id: "c1", name: "diary-export", clientData: { oauth: { dataGrantId: "g1" } } };
    const derived = { id: "d1", name: "oauth:rs", clientData: { oauth: { dataGrantId: "g1", exchange: { subjectClientId: "clinic", subjectAccessId: "s1" } } } };
    const derivedSameId = { id: "d2", name: "oauth:clinic", clientData: { oauth: { dataGrantId: "g1", exchange: { subjectClientId: "clinic", subjectAccessId: "s1" } } } };
    const folded = foldOAuthSessions([s1, app, grant, orphan, created, derived, derivedSameId, s2]);
    expect(folded.map((e) => [e.access.id, e.sessions.map((s) => s.id)])).toEqual([
      ["a1", []],
      ["g1:2", ["s1", "s2"]],
      ["s3", []],
      ["c1", []],
      ["d1", []],
      ["d2", []],
    ]);
  });

  it("[OACN5] an unstamped grant takes its name from a stamped session", () => {
    const grant = { id: "g1", name: "oauth-grant:clinic" };
    const session = { id: "s1", name: "oauth:clinic", clientData: { oauth: { dataGrantId: "g1", client: { name: "Clinic app", origin: "operator" } } } };
    expect(entryNaming({ access: grant, sessions: [session] })).toEqual({ label: "Clinic app" });
    expect(entryNaming({ access: grant, sessions: [] })).toEqual({ label: "clinic" });
    const stamped = { ...grant, clientData: { oauth: { client: { name: "Grant name", origin: "operator" } } } };
    expect(entryNaming({ access: stamped, sessions: [session] })).toEqual({ label: "Grant name" });
  });
});
