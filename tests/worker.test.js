/*
.Example
npm test -- worker.test.js

run the tests in this file.

.Example
nvm exec v16 npm test -- worker.test.js

run the tests in this file using nvm (node version manager)
*/

import * as Adp from '../lib/index.js';

describe('Worker', () => {

  const CERTIFICATE = "-----BEGIN CERTIFICATE-----\nABCDEFGHIJKLMNOPQRSTUVWXYZ\n-----END CERTIFICATE-----\n"
  const PRIVATE_KEY = "-----BEGIN RSA PRIVATE KEY-----\nABCDEFGHIJKLMNOPQRSTUVWXYZ\n-----END RSA PRIVATE KEY-----\n"

  // arrange
  const client = new Adp.AdpClient(CERTIFICATE,PRIVATE_KEY)

    describe.skip('all()', () => {
        it('returns an array of worker objects', () => {
        });
    });

    describe('one()', () => {

        describe('when a valid associateOID is provided', () => {

          it('returns a worker object', async () => {

            // arrange
            const associateOID = 'ABCDEFGHIJKLMNOP'
            const response = require('./fixtures/workers/aoid/200.json');

            // mock
            jest.spyOn(client, 'http_request').mockImplementation(
              () => {
                return response;
              }
            )
  
            // act
            const worker = await client.worker.one(associateOID);
            
            // assert
            expect(worker.associateOID).toBe(associateOID);

          });
  
        });

        describe('when an invalid associateOID is provided', () => {

          it('throws a ForbiddenError', async () => {

            // arrange
            const associateOID = 'ABCDEFGHIJKLMNOP'
            const response = require('./fixtures/workers/aoid/403.json');

            // mock
            jest.spyOn(client, 'http_request').mockImplementation(
              () => {
                const error = new Error(403)
                error.details = response
    
                throw error;
              }
            )

            // act/assert
            await expect(
              client.worker.one(associateOID)
            ).rejects.toThrow(Adp.ForbiddenError);

          });
  
        });

    });

    describe.skip('hire()', () => {
    });

    describe('rehire()', () => {

      describe('when the worker is inactive', () => {

        it('returns an event object', async () => {

          // arrange
          const response = require('./fixtures/worker.rehire/200.json');

          // mock
          jest.spyOn(client, 'http_request').mockImplementation(
            () => {
              return response;
            }
          )

          // act
          const event = await client.worker.rehire({
            associateOID: 'ABCDEFGHIJKLMNOP',
            rehireDate: new Date().toISOString().split('T')[0],
            effectiveDate: new Date().toISOString().split('T')[0],
            reasonCode: 'IMPORT'
          });
          
          // assert
          expect(event).not.toBeNull();

        });

      });

      describe('when the worker is active', () => {

        it('throws a BadRequestError', async () => {

          // arrange
          const response = require('./fixtures/worker.rehire/400.already-active.json');

          // mock
          jest.spyOn(client, 'http_request').mockImplementation(
            () => {
              const error = new Error(400)
              error.details = response
  
              throw error;
            }
          )

            // act/assert
            await expect(
              client.worker.rehire({
                associateOID: 'ABCDEFGHIJKLMNOP',
                rehireDate: new Date().toISOString().split('T')[0],
                effectiveDate: new Date().toISOString().split('T')[0],
                reasonCode: 'IMPORT'
              })
            ).rejects.toThrow(Adp.BadRequestError);

          });

      });

      describe('when an invalid AOID is provided', () => {

        it('throws a BadRequestError', async () => {

          // arrange
          const response = require('./fixtures/worker.rehire/400.invalid-aoid.json');

          // mock
          jest.spyOn(client, 'http_request').mockImplementation(
            () => {
              const error = new Error(400)
              error.details = response
  
              throw error;
            }
          )

            // act/assert
            await expect(
              client.worker.rehire({
                associateOID: 'ABCDEFGHIJKLMNOP',
                rehireDate: new Date().toISOString().split('T')[0],
                effectiveDate: new Date().toISOString().split('T')[0],
                reasonCode: 'IMPORT'
              })
            ).rejects.toThrow(Adp.BadRequestError);

          });

      });

    });

    describe('terminate()', () => {

      describe('when the worker is active', () => {

        it('returns an event object', async () => {

          // arrange
          const response = require('./fixtures/worker.work-assignment.terminate/200.json');

          // mock
          jest.spyOn(client, 'http_request').mockImplementation(
            () => {
              return response;
            }
          )

          // act
          const event = await client.worker.terminate({
            workAssignmentID: 'K4P011981',
            terminationDate: new Date().toISOString().split('T')[0],
            comments: 'testing', 
            reasonCode: 'T'
          });
          
          // assert
          expect(event).not.toBeNull();

        });

      });
      
      describe('when the worker is terminated', () => {

        it('throws a BadRequestError', async () => {

          // arrange
          const response = require('./fixtures/worker.work-assignment.terminate/400.already-terminated.json');

          // mock
          jest.spyOn(client, 'http_request').mockImplementation(
            () => {
              const error = new Error(400)
              error.details = response
  
              throw error;
            }
          )

            // act/assert
            await expect(
              client.worker.terminate({
                workAssignmentID: 'K4P011981',
                terminationDate: new Date().toISOString().split('T')[0],
                comments: 'testing', 
                reasonCode: 'T'
              })
            ).rejects.toThrow(Adp.BadRequestError);

          });

      });

    });

    describe('when an invalid AOID is provided', () => {

      it('throws a BadRequestError', async () => {

        // arrange
        const response = require('./fixtures/worker.work-assignment.terminate/400.invalid-aoid.json');

        // mock
        jest.spyOn(client, 'http_request').mockImplementation(
          () => {
            const error = new Error(400)
            error.details = response

            throw error;
          }
        )

          // act/assert
          await expect(
            client.worker.terminate({
              workAssignmentID: 'K4P011981',
              terminationDate: new Date().toISOString().split('T')[0],
              comments: 'testing', 
              reasonCode: 'T'
            })
          ).rejects.toThrow(Adp.BadRequestError);

        });
    
    });

  });