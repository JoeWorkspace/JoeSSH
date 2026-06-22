import { describe, expect, it } from "vitest";
import { splitConnectionTarget } from "./connectTarget";

describe("splitConnectionTarget", () => {
  it("splits a username-qualified host", () => {
    expect(splitConnectionTarget("atlas@prod-edge-01")).toEqual({
      host: "prod-edge-01",
      username: "atlas",
    });
  });

  it("parses ssh URLs with username and port", () => {
    expect(splitConnectionTarget("ssh://atlas@prod-edge-01.internal:2222")).toEqual({
      host: "prod-edge-01.internal",
      port: 2222,
      username: "atlas",
    });
  });

  it("parses host and username targets with explicit ports", () => {
    expect(splitConnectionTarget("prod-edge-01:2200")).toEqual({
      host: "prod-edge-01",
      port: 2200,
    });
    expect(splitConnectionTarget("atlas@prod-edge-01:2200")).toEqual({
      host: "prod-edge-01",
      port: 2200,
      username: "atlas",
    });
  });

  it("parses bracketed IPv6 targets", () => {
    expect(splitConnectionTarget("[2001:db8::10]:2200")).toEqual({
      host: "2001:db8::10",
      port: 2200,
    });
    expect(splitConnectionTarget("atlas@[2001:db8::10]:2200")).toEqual({
      host: "2001:db8::10",
      port: 2200,
      username: "atlas",
    });
  });

  it("leaves plain or malformed targets as host values", () => {
    expect(splitConnectionTarget("prod-edge-01")).toEqual({ host: "prod-edge-01" });
    expect(splitConnectionTarget("@prod-edge-01")).toEqual({ host: "@prod-edge-01" });
    expect(splitConnectionTarget("atlas@")).toEqual({ host: "atlas@" });
    expect(splitConnectionTarget("prod-edge-01:99999")).toEqual({ host: "prod-edge-01", port: undefined });
    expect(splitConnectionTarget("2001:db8::10")).toEqual({ host: "2001:db8::10" });
  });
});
