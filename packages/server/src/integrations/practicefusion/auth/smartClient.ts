// SPDX-License-Identifier: Apache-2.0

import { SignJWT, importPKCS8 } from 'jose';
import { randomUUID } from 'crypto';

/**
 * Configuration for SMART Backend Services authentication
 * Supports both client_secret and private_key JWT authentication
 */
export interface SmartClientConfig {
  /** Practice Fusion FHIR base URL */
  fhirBaseUrl: string;
  /** OAuth2 token endpoint URL */
  tokenEndpoint: string;
  /** Client ID registered with Practice Fusion */
  clientId: string;
  /** Client secret (for client_credentials with secret) - Optional */
  clientSecret?: string;
  /** Private key in PEM format for JWT signing - Optional */
  privateKeyPem?: string;
  /** Key ID (kid) for the signing key */
  keyId?: string;
  /** Signing algorithm (default: RS384) */
  algorithm?: 'RS384' | 'ES384';
}

/**
 * Access token response from the authorization server
 */
export interface AccessTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

/**
 * SMART Backend Services client for Practice Fusion authentication
 * Implements the SMART Backend Services Authorization specification:
 * https://hl7.org/fhir/smart-app-launch/backend-services.html
 */
export class SmartBackendClient {
  private config: SmartClientConfig;
  private cachedToken: string | null = null;
  private tokenExpiry: Date | null = null;

  constructor(config: SmartClientConfig) {
    this.config = {
      ...config,
      algorithm: config.algorithm || 'RS384',
    };
  }

  /**
   * Get an access token, using cached token if still valid
   */
  async getAccessToken(): Promise<string> {
    // Return cached token if still valid (with 5 minute buffer)
    if (this.cachedToken && this.tokenExpiry) {
      const bufferMs = 5 * 60 * 1000; // 5 minutes
      if (new Date().getTime() < this.tokenExpiry.getTime() - bufferMs) {
        return this.cachedToken;
      }
    }

    // Request new token
    const tokenResponse = await this.requestAccessToken();
    this.cachedToken = tokenResponse.access_token;
    this.tokenExpiry = new Date(Date.now() + tokenResponse.expires_in * 1000);

    return this.cachedToken;
  }

  /**
   * Request a new access token from the authorization server
   * Supports both client_secret and JWT-based authentication
   */
  private async requestAccessToken(): Promise<AccessTokenResponse> {
    console.log('[PFSmartClient] Requesting access token from Practice Fusion...');

    let params: URLSearchParams;
    let authHeader: string | undefined;

    // Determine authentication method
    if (this.config.clientSecret) {
      // Method 1: Client Credentials with Client Secret (simpler)
      console.log('[PFSmartClient] Using client_secret authentication');

      // Request specific scopes for the resources we need
      const scopes = [
        'system/AllergyIntolerance.read',
        'system/Binary.read',
        'system/CarePlan.read',
        'system/Condition.read',
        'system/DiagnosticReport.read',
        'system/DocumentReference.read',
        'system/Encounter.read',
        'system/Immunization.read',
        'system/Medication.read',
        'system/MedicationRequest.read',
        'system/MedicationStatement.read',
        'system/Observation.read',
        'system/Patient.read',
        'system/Practitioner.read',
        'system/ServiceRequest.read',
      ].join(' ');

      params = new URLSearchParams({
        grant_type: 'client_credentials',
        scope: scopes,
      });

      // Use HTTP Basic Auth for client credentials
      const credentials = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64');
      authHeader = `Basic ${credentials}`;
    } else if (this.config.privateKeyPem) {
      // Method 2: JWT-based authentication (SMART Backend Services)
      console.log('[PFSmartClient] Using private_key_jwt authentication');
      const clientAssertion = await this.generateClientAssertion();

      // Request specific scopes for the resources we need
      const scopes = [
        'system/AllergyIntolerance.read',
        'system/Binary.read',
        'system/CarePlan.read',
        'system/Condition.read',
        'system/DiagnosticReport.read',
        'system/DocumentReference.read',
        'system/Encounter.read',
        'system/Immunization.read',
        'system/Medication.read',
        'system/MedicationRequest.read',
        'system/MedicationStatement.read',
        'system/Observation.read',
        'system/Patient.read',
        'system/Practitioner.read',
        'system/ServiceRequest.read',
      ].join(' ');

      params = new URLSearchParams({
        grant_type: 'client_credentials',
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: clientAssertion,
        scope: scopes,
      });
    } else {
      throw new Error('Either clientSecret or privateKeyPem must be provided for authentication');
    }

    // Make token request
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    if (authHeader) {
      headers['Authorization'] = authHeader;
    }

    const response = await fetch(this.config.tokenEndpoint, {
      method: 'POST',
      headers,
      body: params.toString(),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('[PFSmartClient] Token request failed:', response.status, errorBody);
      throw new Error(`Failed to get access token: ${response.status} ${errorBody}`);
    }

    const tokenResponse = (await response.json()) as AccessTokenResponse;
    console.log('[PFSmartClient] Successfully obtained access token');

    return tokenResponse;
  }

  /**
   * Generate a signed JWT for client authentication
   * Per SMART Backend Services spec:
   * - iss: client_id
   * - sub: client_id
   * - aud: token endpoint URL
   * - jti: unique identifier
   * - exp: expiration time (max 5 minutes)
   */
  private async generateClientAssertion(): Promise<string> {
    if (!this.config.privateKeyPem) {
      throw new Error('Private key is required for JWT authentication');
    }

    const now = Math.floor(Date.now() / 1000);
    const exp = now + 300; // 5 minutes

    // Import the private key
    const privateKey = await importPKCS8(this.config.privateKeyPem, this.config.algorithm!);

    // Build and sign the JWT
    const jwt = await new SignJWT({
      iss: this.config.clientId,
      sub: this.config.clientId,
      aud: this.config.tokenEndpoint,
      jti: randomUUID(),
    })
      .setProtectedHeader({
        alg: this.config.algorithm!,
        typ: 'JWT',
        kid: this.config.keyId,
      })
      .setIssuedAt(now)
      .setExpirationTime(exp)
      .sign(privateKey);

    return jwt;
  }

  /**
   * Clear the cached token (useful for testing or forced refresh)
   */
  clearCache(): void {
    this.cachedToken = null;
    this.tokenExpiry = null;
  }
}

/**
 * Discover OAuth2 endpoints from the FHIR server's .well-known configuration
 */
export async function discoverSmartEndpoints(fhirBaseUrl: string): Promise<{
  tokenEndpoint: string;
  authorizationEndpoint?: string;
}> {
  // Try SMART configuration first
  const smartConfigUrl = `${fhirBaseUrl.replace(/\/$/, '')}/.well-known/smart-configuration`;

  try {
    const response = await fetch(smartConfigUrl);
    if (response.ok) {
      const config = (await response.json()) as {
        token_endpoint: string;
        authorization_endpoint?: string;
      };
      return {
        tokenEndpoint: config.token_endpoint,
        authorizationEndpoint: config.authorization_endpoint,
      };
    }
  } catch (error) {
    console.log('[PFSmartClient] Could not fetch smart-configuration, trying oauth-authorization-server...');
  }

  // Fall back to OAuth authorization server metadata
  const oauthConfigUrl = `${fhirBaseUrl.replace(/\/$/, '')}/.well-known/oauth-authorization-server`;

  const response = await fetch(oauthConfigUrl);
  if (!response.ok) {
    throw new Error(`Failed to discover SMART endpoints: ${response.status}`);
  }

  const config = (await response.json()) as {
    token_endpoint: string;
    authorization_endpoint?: string;
  };

  return {
    tokenEndpoint: config.token_endpoint,
    authorizationEndpoint: config.authorization_endpoint,
  };
}
