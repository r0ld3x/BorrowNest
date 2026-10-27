import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formFields, resetPasswordSchema, signUpSchema, updateNameSchema } from "./auth.ts";

const valid = {
  fullName: "  Asha   Verma ",
  email: " Asha@Example.COM ",
  password: "correct horse",
  accountType: "provider",
};

describe("signUpSchema", () => {
  it("normalizes valid input", () => {
    const result = signUpSchema.parse(valid);
    assert.equal(result.fullName, "Asha Verma");
    assert.equal(result.email, "asha@example.com");
    assert.equal(result.accountType, "provider");
  });

  it("never accepts admin as an account type", () => {
    for (const accountType of ["admin", "Admin", "", "superuser"]) {
      assert.equal(signUpSchema.safeParse({ ...valid, accountType }).success, false, accountType);
    }
  });

  it("enforces password and name bounds", () => {
    assert.equal(signUpSchema.safeParse({ ...valid, password: "short" }).success, false);
    assert.equal(signUpSchema.safeParse({ ...valid, password: "x".repeat(73) }).success, false);
    assert.equal(signUpSchema.safeParse({ ...valid, fullName: "   " }).success, false);
    assert.equal(signUpSchema.safeParse({ ...valid, fullName: "a".repeat(101) }).success, false);
    assert.equal(signUpSchema.safeParse({ ...valid, email: "not-an-email" }).success, false);
  });
});

describe("updateNameSchema", () => {
  it("keeps HTML-looking names as plain text and strips control characters", () => {
    const result = updateNameSchema.parse({ fullName: "<b>Ravi</b>\u0000\n" });
    assert.equal(result.fullName, "<b>Ravi</b>");
  });
});

describe("resetPasswordSchema", () => {
  it("requires matching passwords", () => {
    const result = resetPasswordSchema.safeParse({ password: "new password 1", confirmPassword: "different" });
    assert.equal(result.success, false);
  });
});

describe("formFields", () => {
  it("ignores files and missing keys", () => {
    const data = new FormData();
    data.set("email", "a@b.test");
    data.set("password", new Blob(["x"]));
    assert.deepEqual(formFields(data, ["email", "password", "missing"]), {
      email: "a@b.test",
      password: "",
      missing: "",
    });
  });
});
