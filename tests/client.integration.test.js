/*
.Example
npm test -- client.test.js

run the tests in this file.

.Example
nvm exec v18 npm test -- adp_client.test.js

run the tests in this file using nvm (node version manager)
*/

require('dotenv').config();

const crypto = require('crypto')

describe('Client', () => {

  // arrange
  const Adp = require('../lib')
  
  const client = new Adp.Client(process.env.ADP_CERTIFICATE, process.env.ADP_PRIVATE_KEY)

  describe('when the authenticate() method is called', () => {

    describe('when valid credentials are provided', () => {
      
      it('returns a credential object with an access_token', async () => {

        // act        
        const credentials = await client.authenticate(process.env.ADP_CLIENT_ID, process.env.ADP_CLIENT_SECRET)
        process.env.ADP_ACCESS_TOKEN = credentials.access_token

        // assert
        expect(credentials.access_token).not.toBeNull();

      });

    });

    describe('when invalid credentials are provided', () => {

      it('throws an UnauthorizedError', async () => {

        // arrange
        const client_id = crypto.randomUUID()
        const client_secret = crypto.randomUUID()

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

        // act/assert
        await expect(
          client.authenticate(client_id, client_secret)
        ).rejects.toThrow(Adp.UnauthorizedError);

      });

    });

  });

});