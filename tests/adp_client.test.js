describe('AdpClient', () => {

  describe('when the get() methods is called', () => {

    it('returns an object with firstName and lastName properties', () => {

      // arrange
      const AdpClient = require("../adp_client")
      const client = new AdpClient()

      // act
      const results = client.get();
      console.debug('results',results)

      // assert
      expect(results.firstName).not.toBeNull();
      expect(results.lastName).not.toBeNull();

    });

  });

});