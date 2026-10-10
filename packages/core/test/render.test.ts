import { describe, expect, it } from "vitest";
import { SourceParseError, buildOutputs } from "../src/render";

describe("building a workload's ConfigMap and Secret", () => {
  it("puts config files in the ConfigMap and secret files in the Secret", () => {
    const outputs = buildOutputs({ config: "GREETING=hello", secrets: "DB_PASSWORD=s3cret" });
    expect(outputs.configMapData).toEqual({ GREETING: "hello" });
    expect(outputs.secretData).toEqual({ DB_PASSWORD: "s3cret" });
  });

  it("adds the common values, the workload's own value winning", () => {
    const outputs = buildOutputs({
      commonConfig: "LOG_LEVEL=info\nREGION=eu-west-1",
      config: "LOG_LEVEL=debug",
      commonSecrets: "SHARED_API_TOKEN=common",
      secrets: "DB_PASSWORD=s3cret",
    });
    expect(outputs.configMapData).toEqual({ LOG_LEVEL: "debug", REGION: "eu-west-1" });
    expect(outputs.secretData).toEqual({ SHARED_API_TOKEN: "common", DB_PASSWORD: "s3cret" });
  });

  it("treats a missing file as empty", () => {
    expect(buildOutputs({})).toMatchObject({ configMapData: {}, secretData: {} });
  });

  it("keeps the same hash when a common value changes that the workload overrides", () => {
    const before = buildOutputs({ commonConfig: "LOG_LEVEL=info", config: "LOG_LEVEL=debug" });
    const after = buildOutputs({ commonConfig: "LOG_LEVEL=warn", config: "LOG_LEVEL=debug" });
    expect(after.configHash).toBe(before.configHash);
  });

  it("changes the hash when a common value changes that the workload does not override", () => {
    const before = buildOutputs({ commonConfig: "REGION=eu-west-1", config: "LOG_LEVEL=debug" });
    const after = buildOutputs({ commonConfig: "REGION=us-east-1", config: "LOG_LEVEL=debug" });
    expect(after.configHash).not.toBe(before.configHash);
  });

  it("produces nothing at all when any one file cannot be parsed, and says which file and line", () => {
    const build = () => buildOutputs({ config: "GREETING=hello", secrets: "DB_PASSWORD=s3cret\nnot a setting" });
    expect(build).toThrow(SourceParseError);
    expect(build).toThrow("secrets, line 2: expected KEY=value");
  });
});
