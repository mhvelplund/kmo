import { describe, expect, it } from "vitest";
import { SourceParseError, buildOutputs, type SourceTexts } from "../src/render";

/** One source, named after its store. */
const from = (store: string, texts: SourceTexts) => ({ store, texts });

describe("building a workload's ConfigMap and Secret", () => {
  it("puts config files in the ConfigMap and secret files in the Secret", () => {
    const outputs = buildOutputs([from("A", { config: "GREETING=hello", secrets: "DB_PASSWORD=s3cret" })]);
    expect(outputs.configMapData).toEqual({ GREETING: "hello" });
    expect(outputs.secretData).toEqual({ DB_PASSWORD: "s3cret" });
  });

  it("adds the common values, the workload's own value winning", () => {
    const outputs = buildOutputs([
      from("A", {
        commonConfig: "LOG_LEVEL=info\nREGION=eu-west-1",
        config: "LOG_LEVEL=debug",
        commonSecrets: "SHARED_API_TOKEN=common",
        secrets: "DB_PASSWORD=s3cret",
      }),
    ]);
    expect(outputs.configMapData).toEqual({ LOG_LEVEL: "debug", REGION: "eu-west-1" });
    expect(outputs.secretData).toEqual({ SHARED_API_TOKEN: "common", DB_PASSWORD: "s3cret" });
  });

  it("treats a missing file as empty, and no sources as no values", () => {
    expect(buildOutputs([from("A", {})])).toMatchObject({ configMapData: {}, secretData: {} });
    expect(buildOutputs([])).toMatchObject({ configMapData: {}, secretData: {} });
  });

  it("keeps the same hash when a common value changes that the workload overrides", () => {
    const before = buildOutputs([from("A", { commonConfig: "LOG_LEVEL=info", config: "LOG_LEVEL=debug" })]);
    const after = buildOutputs([from("A", { commonConfig: "LOG_LEVEL=warn", config: "LOG_LEVEL=debug" })]);
    expect(after.configHash).toBe(before.configHash);
  });

  it("changes the hash when a common value changes that the workload does not override", () => {
    const before = buildOutputs([from("A", { commonConfig: "REGION=eu-west-1", config: "LOG_LEVEL=debug" })]);
    const after = buildOutputs([from("A", { commonConfig: "REGION=us-east-1", config: "LOG_LEVEL=debug" })]);
    expect(after.configHash).not.toBe(before.configHash);
  });

  it("produces nothing at all when any one file cannot be parsed, and says which store, file and line", () => {
    const build = () =>
      buildOutputs([
        from("ClusterConfigStore/default", { config: "GREETING=hello" }),
        from("ConfigStore/team", { secrets: "DB_PASSWORD=s3cret\nnot a setting" }),
      ]);
    expect(build).toThrow(SourceParseError);
    expect(build).toThrow("ConfigStore/team secrets, line 2: expected KEY=value");
  });
});

describe("a workload with several sources", () => {
  it("lets a later source win over an earlier one", () => {
    const outputs = buildOutputs([
      from("A", { config: "LOG_LEVEL=info\nREGION=eu-west-1", secrets: "TOKEN=a" }),
      from("B", { config: "LOG_LEVEL=debug", secrets: "TOKEN=b" }),
    ]);
    expect(outputs.configMapData).toEqual({ LOG_LEVEL: "debug", REGION: "eu-west-1" });
    expect(outputs.secretData).toEqual({ TOKEN: "b" });
  });

  it("merges every common file before any service file, so a service value beats a common value from a later source", () => {
    const outputs = buildOutputs([
      from("A", { commonConfig: "LOG_LEVEL=a-common\nREGION=a-common", config: "LOG_LEVEL=a-service" }),
      from("B", { commonConfig: "LOG_LEVEL=b-common\nREGION=b-common" }),
    ]);
    expect(outputs.configMapData).toEqual({ LOG_LEVEL: "a-service", REGION: "b-common" });
  });
});
