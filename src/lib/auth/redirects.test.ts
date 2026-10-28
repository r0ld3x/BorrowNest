import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { dashboardPathFor, getSafeRedirectPath, isProtectedPath } from "./redirects.ts";

describe("getSafeRedirectPath", () => {
  it("accepts allowlisted internal destinations", () => {
    for (const path of ["/dashboard", "/account", "/renter", "/provider", "/admin"]) {
      assert.equal(getSafeRedirectPath(path), path);
    }
  });

  it("rejects external, protocol-relative, and malformed destinations", () => {
    for (const value of [
      "https://evil.example",
      "//evil.example",
      "///evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "http:/evil.example",
      "javascript:alert(1)",
      "/admin/../..//evil.example",
      "/admin?x=1",
      "/admin#x",
      "/Admin",
      " /admin",
      "/admin/",
      "/listings",
      "/auth/confirm",
      "",
    ]) {
      assert.equal(getSafeRedirectPath(value), null, value);
    }
  });

  it("accepts exactly a listing detail path, nothing looser", () => {
    const id = "3f9c1a2e-8b7d-4c6e-9f0a-1b2c3d4e5f60";
    assert.equal(getSafeRedirectPath(`/listings/${id}`), `/listings/${id}`);
    for (const value of [
      `/listings/${id}/`,
      `/listings/${id}?x=1`,
      `/listings/${id}#x`,
      `/listings/${id.toUpperCase()}`,
      `//listings/${id}`,
      `/listings/${id}/../../admin`,
      `/listings/not-a-uuid`,
      `https://evil.example/listings/${id}`,
      `/listings/${id}%2F%2Fevil.example`,
    ]) {
      assert.equal(getSafeRedirectPath(value), null, value);
    }
  });

  it("rejects non-string values", () => {
    for (const value of [undefined, null, ["/admin"], 1, {}]) {
      assert.equal(getSafeRedirectPath(value), null);
    }
  });
});

describe("isProtectedPath", () => {
  it("matches protected prefixes on segment boundaries only", () => {
    assert.equal(isProtectedPath("/admin"), true);
    assert.equal(isProtectedPath("/admin/settings"), true);
    assert.equal(isProtectedPath("/account-status"), true);
    assert.equal(isProtectedPath("/administrator"), false);
    assert.equal(isProtectedPath("/listings"), false);
    assert.equal(isProtectedPath("/login"), false);
  });
});

describe("dashboardPathFor", () => {
  it("maps each role to its dashboard", () => {
    assert.equal(dashboardPathFor("renter"), "/renter");
    assert.equal(dashboardPathFor("provider"), "/provider");
    assert.equal(dashboardPathFor("admin"), "/admin");
  });
});
