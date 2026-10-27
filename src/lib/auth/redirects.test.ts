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
