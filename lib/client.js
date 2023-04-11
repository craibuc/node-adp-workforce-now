const UnauthorizedError = require('./unauthorized_error.js')
const ForbiddenError = require('./forbidden_error.js')
const Worker = require('./worker.js')

const querystring = require('querystring')
const https = require('https')

class Client {

    constructor(certificate, private_key) {

        this.certificate = certificate;
        this.private_key= private_key;
        
        this.worker = new Worker(this)

    }
  
    /**
     * 
     * @param {*} client_id 
     * @param {*} client_secret 
     */
    authenticate = async (client_id, client_secret) => {

        const body = querystring.stringify({
            client_id: client_id,
            client_secret: client_secret,
            grant_type: 'client_credentials',
        });
    
        const headers = {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': body.length
        }

        try {
            const credentials = await this.http_request('/auth/oauth/v2/token', 'POST', headers, body)
    
            const now = new Date()
            credentials.expires_at = now.setSeconds(now.getSeconds() + credentials.expires_in);
    
            this.access_token = credentials.access_token
    
            return credentials    
        } 
        catch (error) {
            if (error.message == '401') { throw new UnauthorizedError(error.details.error_description) }
            else if (error.message == '403') { throw new ForbiddenError(error.details.error_description) }
            else { throw error }
        }

    }

    /**
     * Convenience method for HTTP GET
     * @param {*} path 
     * @returns 
     */
    get = async (path) => {

        const headers = {
            'Accept': 'application/json;masked=false',
            Authorization: `Bearer ${this.access_token}`
        }
        // console.debug('headers',headers)

        return await this.http_request(path, 'GET', headers, null)

    }

    /**
     * Convenience method for HTTP POST
     * @param {*} path 
     * @param {*} data 
     * @returns 
     */
    post = async (path, data) => {

        const body = JSON.stringify(data)
        // console.debug('body',body)

        const headers = {
            'Content-Type': 'application/json',
            'Content-Length': body.length,
            Authorization: `Bearer ${this.access_token}`
        }
        // console.debug('headers',headers)

        return await this.http_request(path, 'POST', headers, body)

    }

    /**
     * Make HTTP requests
     * @param {*} path - relative Url
     * @param {*} method  - GET or POST
     * @param {*} headers 
     * @param {*} body 
     * @returns 
     */
    http_request = async (path, method, headers, body) => {

        return new Promise((resolve, reject) => {
    
            const options = {
                hostname: 'api.adp.com',
                path: path,
                method: method,
                headers: headers,
                cert: this.certificate,
                key: this.private_key,
            };

            const req = https.request(options, (res) => {
        
                let data = [];
            
                res.on('data', chunk => {
                    data.push(chunk);
                });
                
                res.on('end', () => {

                    // TODO: could this be improved?
                    const json = data.length > 0 ? JSON.parse(Buffer.concat(data).toString()) : undefined;
                    // console.log('json',json)

                    if (res.statusCode < 200 || res.statusCode >= 300) {

                        const error = new Error(res.statusCode)
                        error.details = json
                        reject(error)

                    }
                    else {
                        resolve(json); 
                    }
    
                });
    
            });
        
            req.on('error', (e) => {
                reject(e.message);
            });
    
            if (method == 'POST') { req.write(body); }
    
            req.end();
        
        });
    
    }

}
module.exports = Client