export const JWT_KEY_PROVIDER = Symbol('JWT_KEY_PROVIDER');

export interface JwtKeyProviderPort {
  getPublicKey(): Promise<string>;
}
