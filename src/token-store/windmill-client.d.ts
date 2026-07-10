declare module 'windmill-client' {
  export function getVariable(path: string): Promise<string>;
  export function setVariable(
    path: string,
    value: string,
    isSecretIfNotExist?: boolean,
    descriptionIfNotExist?: string,
  ): Promise<void>;
}
