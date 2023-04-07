class Worker {

    // get a reference to the client
    constructor(parent) {
        this.parent = parent;
    }

    /**
     * 
     * @returns 
     */
    all = async () => {
    
        let workers = []
    
        let page=0
        const pageSize=100
    
        let proceed = true
    
        do {
    
            let path = `/hr/v2/workers?$top=${pageSize}&$skip=${ page * pageSize }`

            const response = await this.parent.get(path)

            // TODO: could this be improved?
            if ( response === undefined ) { proceed = false; break; }

            // append to array
            workers = workers.concat(response.workers);
            // console.log(`Page ${page}`,response.workers.length)
        
            page++

        } while (proceed);
    
        return workers

    }

    /**
     * 
     * @param {*} associateOID 
     * @returns 
     */
    one = async (associateOID) => {
    
        try {
            return (await this.parent.get(`/hr/v2/workers/${associateOID}`)).workers[0]
        } 
        catch (error) {
            if (error.message == '403') { throw new ForbiddenError(`AOID ${associateOID} does not exist`) }
            else { throw error }
        }
    
    }

    /**
     * 
     * @param {*} param0 
     * @returns 
     */
    hire = async ({givenName, familyName, birthDate, genderCode, ssn, lineOne, lineTwo, cityName, stateCode, postalCode, hireDate, payrollGroupCode}) => {

        const data = {
            "events": [{
                "data": {
                    "transform": {
                        "eventReasonCode": {
                            "codeValue": "NEW"
                        },
                        "worker": {
                            "person": {
                                "governmentIDs": [
                                    {
                                        "idValue": ssn,
                                        "nameCode": {
                                            "codeValue": "SSN"
                                        }
                                    }
                                ],
                                "legalName": {
                                    "givenName": givenName,
                                    "familyName1": familyName
                                },
                                "legalAddress": {
                                    "nameCode": {
                                        "codeValue": "PersonalAddress1"
                                    },
                                    "lineOne": lineOne,
                                    "lineTwo": lineTwo,
                                    "cityName": cityName,
                                    "countrySubdivisionLevel1": {
                                        "codeValue": stateCode
                                    },
                                    "countryCode": "US",
                                    "postalCode": postalCode
                                },
                                "birthDate": birthDate,
                                "genderCode": {
                                    "codeValue": genderCode
                                }
                            },
                            "workAssignment": {
                                "hireDate": hireDate,
                                "payrollGroupCode": payrollGroupCode,
                                "payrollFileNumber": "123456"
                            }
                        }
                    }
                }
            }]
        }
    
        try {
            return await this.parent.post('/events/hr/v1/worker.hire', data)
        } 
        catch (error) {
            if (error.message == '400') { throw new BadRequestError( error.details.confirmMessage.resourceMessages[0].processMessages[0].userMessage.messageTxt ) }
            else { throw error }
        }

    }

    /**
     * 
     * @returns 
     */
    hire_meta = async () => {

        return await this.parent.get('/events/hr/v1/worker.hire/meta')

    }

    /**
     * 
     * @param {*} param0 
     * @returns 
     */
    rehire = async ({associateOID, rehireDate, effectiveDate, reasonCode = 'IMPORT'}) => {

        const data = {
            "events": [
                {
                    "data":{
                        "transform":
                            {
                                "effectiveDateTime": effectiveDate,
                                "worker":
                                {
                                    "associateOID": associateOID,
                                    "workerDates":
                                    {
                                        "rehireDate": rehireDate
                                    },
                                    "workerStatus":
                                    {
                                        "reasonCode": {
                                            "codeValue": reasonCode
                                        }
                                    }
                                }
                            }
                        
                    }
                }
            ]
        }
    
        try {
            return await this.parent.post('/events/hr/v1/worker.rehire', data)            
        } 
        catch (error) {
            if (error.message == '400') { throw new BadRequestError( error.details.confirmMessage.resourceMessages[0].processMessages[0].userMessage.messageTxt ) }
            else { throw error }
        }

    }

    /**
     * 
     * @param {*} param0 
     * @returns 
     */
    terminate = async ({workAssignmentID, comments, terminationDate, reasonCode}) => {

        const data = {
            "events": [
                {
                    "data": {
                        "eventContext": {
                            "contextExpressionID": "",
                            "worker": {
                                "workAssignment": {
                                    "itemID": workAssignmentID
                                }
                            }
                        },
                        "transform": {
                            "comment": {
                                "commentCode": {
                                    "codeValue": comments
                                }
                            },
                            "worker": {
                                "workAssignment": {
                                    "terminationDate": terminationDate,
                                    "lastWorkedDate": terminationDate,
                                    "assignmentStatus": {
                                        "reasonCode": {
                                            "codeValue": reasonCode
                                        }
                                    },
                                    "rehireEligibleIndicator": true,
                                    "severanceEligibleIndicator": true
                                }
                            }
                        }
                    }
                }
            ]
        }
    
        try {
            return await this.parent.post('/events/hr/v1/worker.work-assignment.terminate', data)    
        } 
        catch (error) {
            if (error.message == '400') { throw new BadRequestError( error.details.exceptionMessages[0].message ) }
            else { throw error }
        }

    }

}

module.exports = Worker