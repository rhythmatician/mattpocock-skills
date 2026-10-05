import type { AnySchema, ErrorObject } from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const formatError = (error: ErrorObject) => {
  const location = error.instancePath || "/";
  return `${location} ${error.message ?? error.keyword}`;
};

export const validateJsonSchemaInstance = (
  schema: unknown,
  instance: unknown,
) => {
  try {
    const validator = new Ajv2020({ allErrors: true, strict: false });
    addFormats(validator);
    const validate = validator.compile(schema as AnySchema);
    if (validate(instance)) return [];
    return (validate.errors ?? []).map(formatError);
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
};
