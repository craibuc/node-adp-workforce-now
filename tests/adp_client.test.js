/*
.Example
npm test -- adp_client.test.js

run the tests in this file.

.Example
nvm exec v18 npm test -- adp_client.test.js

run the tests in this file using nvm (node version manager)
*/

describe('AdpClient', () => {

  const CERTIFICATE = "-----BEGIN CERTIFICATE-----\nABCDEFGHIJKLMNOPQRSTUVWXYZ\n-----END CERTIFICATE-----\n"
  const PRIVATE_KEY = "-----BEGIN RSA PRIVATE KEY-----\nABCDEFGHIJKLMNOPQRSTUVWXYZ\n-----END RSA PRIVATE KEY-----\n"

  // arrange
  const Adp = require('../lib')
  const client = new Adp.AdpClient(CERTIFICATE,PRIVATE_KEY)

  const crypto = require('crypto')

  describe('when the authenticate() method is called', () => {

    describe('when valid credentials are provided', () => {
      
      it('returns a credential object with an access_token', async () => {

        // arrange
        const client_id = crypto.randomUUID()
        const client_secret = crypto.randomUUID()
  
        // mock
        jest.spyOn(client, 'http_request').mockImplementation(
          () => {
            return {
              "access_token": crypto.randomUUID(),
              "token_type": "Bearer",
              "expires_in": 3600,
              "scope": "api"
            };
          }
        )

        // act
        const credential = await client.authenticate(client_id, client_secret);

        // assert
        expect(credential.access_token).not.toBeNull();

      });

    });

    describe('when invalid credentials are provided', () => {

      it('throws an UnauthorizedError', async () => {

        // arrange
        const client_id = crypto.randomUUID()
        const client_secret = crypto.randomUUID()

        jest.spyOn(client, 'http_request').mockImplementation(
          () => {
            const error = new Error(401)
            error.details = {
              "error": "invalid_client",
              "error_description": "The given client credentials were not valid"
            }

            throw error;
          }
        )

        // act/assert
        await expect(
          client.authenticate(client_id, client_secret)
        ).rejects.toThrow(Adp.UnauthorizedError);

      });

    });

    describe("when a certificate isn't provided", () => {

      it('throws an UnauthorizedError', async () => {

        // arrange
        const client_id = crypto.randomUUID()
        const client_secret = crypto.randomUUID()
        
        client.certificate = null
        client.private_key = null

        jest.spyOn(client, 'http_request').mockImplementation(
          () => {
            const error = new Error(401)
            error.details = {
              "error": "invalid_request",
              "error_description": "proper client ssl certificate was not presented"
            }

            throw error;
          }
        )

        // act/assert
        await expect(
          client.authenticate(client_id, client_secret)
        ).rejects.toThrow(Adp.UnauthorizedError);

      });

    });

  });

});