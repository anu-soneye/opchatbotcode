// Enviroment Variables
const atapikey = process.env.AIRTABLE_API_KEY;
const atbaseid = process.env.AIRTABLE_BASE_ID;

// Modules Required
const Airtable = require("airtable");

// Functions to be exported
function searchUniqueValueToRetreiveRecordId(tableName, field, value){
    const base = new Airtable({
        apiKey: atapikey
        }).base(atbaseid);

    let recordId;

    return new Promise((resolve, reject) => {
        base(tableName)
        .select({view: "Grid view", fields: [field], maxRecords: 1, filterByFormula: `{${field}} = '${value}'`})
        .firstPage(function(err, records) {
            if (err) { 
                reject(err);
            }
            if (records == null){
                resolve(-1)
            
            }
            else if (records.length != 0){
                records.forEach(function(record) {
                    recordId = record.id;
                });
                resolve(recordId);
            }
            else{
                resolve(-1);
            }
        });
    });
}
function retreiveValueFromRecord(tableName, recordId, fields){
    const base = new Airtable({
        apiKey: atapikey
        }).base(atbaseid);

    let retreivedValues = [];

    return new Promise((resolve, reject) => {
        base(tableName)
        .find(recordId, function(err, record){
            if (err) {
                reject(err);
            }
            for (let i = 0; i < fields.length; i++){
                retreivedValues.push(record.get(fields[i]));
            }
            resolve(retreivedValues);
        })
    });
}
function updateFieldsOfRecord(tableName, recordId, fieldsObject){
    const base = new Airtable({
        apiKey: atapikey
        }).base(atbaseid);

    return new Promise((resolve, reject) => {
        base(tableName)
        .update([
            {
                id: recordId,
                fields: fieldsObject
            }
        ], function (err, records){
            if (err){
                reject(err);
            }
            resolve(0);
        });
    });
}

function weightedAverage(userPreference, opDetail){
    let score = 0;
    let anyCounter = 0
    let maxPreference = Object.keys(userPreference).length;

    if (opDetail == null || opDetail == []){
        return(0);
    }

    for (key in userPreference){
        if (userPreference[key].includes("Any") && anyCounter < 2){
            anyCounter += 1;
        }
        else if (opDetail.includes(userPreference[key])){
            score += (maxPreference + 30 - parseInt(key))/parseInt(key);
        }
    }

    if (score ==  0 && anyCounter >= 1){
        score = 10;
    }
    return (score);
}

async function scanForRecommendedOp(phoneNumber){
    let recordId = await searchUniqueValueToRetreiveRecordId('user-info','phone', phoneNumber);
    // let oppurtunityScore = {"op-id": score};

    let [userProfileObject, opScanned, lastOpFeaturePriority] = await retreiveValueFromRecord('user-info', recordId, ['user-profile-object', 'op-ids-scanned', 'last-op-feature-priority']);

    userProfileObject = (userProfileObject !=  null) ? JSON.parse(userProfileObject) : {};
    opScanned = (opScanned !=  null) ? JSON.parse(opScanned) : {};
    lastOpFeaturePriority = (lastOpFeaturePriority !=  null) ? JSON.parse(lastOpFeaturePriority) : {};
    
    updateAllOppurtunityScores = (JSON.stringify(lastOpFeaturePriority) != JSON.stringify(userProfileObject["op-feature-rec-priority"])) ? true : false;

    // Search through all oppurtunties and calculate score for new ones or if the feature priority has been updated
    let updatedOpScanned = await calculateScoreForOps(opScanned, updateAllOppurtunityScores, userProfileObject);

    await updateFieldsOfRecord('user-info', recordId, {"op-ids-scanned":JSON.stringify(updatedOpScanned), "last-op-feature-priority": JSON.stringify(userProfileObject["op-feature-rec-priority"])});
}
async function calculateScoreForOps(opScanned, updateAllOppurtunityScores, userProfileObject){
    const base = new Airtable({
        apiKey: atapikey
        }).base(atbaseid);

    let updatedOpScanned = {};
    return (new Promise((resolve, reject) => {
        base('final-ops').select({
            view: "Grid view"
        }).eachPage(function page(records, fetchNextPage) {
            // This function (`page`) will get called for each page of records.
        
            records.forEach(function(record) {
                let final_score = 0.0;
                let score_major = 0.0;
                let score_time = 0.0;
                let score_type = 0.0;
                let opID = record.get("op-id");
                if ((opID != null && (opScanned[opID] == null ))|| updateAllOppurtunityScores){
                    if (userProfileObject.major != null){
                        score_major = weightedAverage({"1": userProfileObject.major}, record.get("major"));
                    }
                    if (userProfileObject["op-type-priority"] != null){
                        score_type = weightedAverage(userProfileObject["op-type-priority"], record.get("type"));
                    }

                    let date = record.get("date");
                    if (record.get("date") == null){
                        score_time = 0
                    }
                    else if ((new Date(date)).getTime() > Date.now()){
                        let yesterdayDate = new Date();
                        yesterdayDate = yesterdayDate.setDate(yesterdayDate.getDate() - 1);
                        score_time = 10 * Math.cbrt(100 * (Date.now() - yesterdayDate)/(new Date(date).getTime() - yesterdayDate));
                    }
                    else{
                        score_time = 0;
                    }

                    if (userProfileObject["op-feature-rec-priority"] != null){
                        let maxPreference = Object.keys(userProfileObject["op-feature-rec-priority"]).length;
                        for (key in userProfileObject["op-feature-rec-priority"]){
                            if(userProfileObject["op-feature-rec-priority"][key] == "Major"){
                                final_score += (maxPreference + 1 - parseInt(key)) * score_major;
                            }
                            else if(userProfileObject["op-feature-rec-priority"][key] == "Type of Preferred Oppurtunity"){
                                final_score += (maxPreference  + 1 - parseInt(key)) * score_type;
                            }
                            else{
                                final_score += (maxPreference + 1 - parseInt(key)) * score_time;
                            }
                        }
                    }
                    else{
                        final_score = score_major + score_time + score_type;
                    }
                    let breakdownObject = {final: final_score, major: score_major, type: score_type, time: score_time};
                    let companyBlastInfo = record.get("company-blast-info")
                    if (companyBlastInfo != null){
                        companyBlastInfo = JSON.parse(companyBlastInfo);
                        breakdownObject.blast = "true";
                        breakdownObject.companyBlastInfo = companyBlastInfo;
                    }
                    updatedOpScanned[opID] = breakdownObject;
                }
                else{
                    updatedOpScanned[opID] = opScanned[opID];
                }
            });
        
            // To fetch the next page of records, call `fetchNextPage`.
            // If there are more records, `page` will get called again.
            // If there are no more records, `done` will get called.
            fetchNextPage();

            resolve(updatedOpScanned);
        
        }, function done(err) {
            if (err) { console.error(err); reject(err); }
        });
    }));
}

async function findBestOp(phoneNumber){
    // scan oppurtunies and calculate score
    await scanForRecommendedOp(phoneNumber);

    // search through oppurtunties scanned to find highes scored oppurtunity not previously seen
    let recordId = await searchUniqueValueToRetreiveRecordId('user-info','phone', phoneNumber);

    let [opIdSeen, opScanned] = await retreiveValueFromRecord('user-info', recordId, ['op-ids-seen', 'op-ids-scanned']);

    opScanned = (opScanned !=  null) ? JSON.parse(opScanned) : {};
    opIdSeen = (opIdSeen != null) ? opIdSeen.split(",") : [];

    let highestScoreNotSeen = -1;
    let highestOpIdNotSeen = -1;
    for (key in opScanned){
        if (!(opIdSeen.includes(key)) && (highestScoreNotSeen < opScanned[key]["final"]) && opScanned[key]["blast"] == null){
            highestScoreNotSeen = opScanned[key]["final"];
            highestOpIdNotSeen = key;
        }
    }

    if (highestOpIdNotSeen != -1){
        opIdSeen.push(highestOpIdNotSeen)
    }

    await updateFieldsOfRecord('user-info', recordId, {"op-ids-seen":opIdSeen.toString()}); // update user profile to add new oppurtunity in seen list
    res = [highestOpIdNotSeen, opScanned[highestOpIdNotSeen]];
    return(res);
}

async function findBestCompanyBlastOp(phoneNumber){
    // search through oppurtunties scanned to find highes scored oppurtunity not previously seen
    let recordId = await searchUniqueValueToRetreiveRecordId('user-info','phone', phoneNumber);

    let [opIdSeen, opScanned] = await retreiveValueFromRecord('user-info', recordId, ['op-ids-seen', 'op-ids-scanned']);

    opScanned = (opScanned !=  null) ? JSON.parse(opScanned) : {};
    opIdSeen = (opIdSeen != null) ? opIdSeen.split(",") : [];

    let highestCompanyBlastScoreNotSeen = -1;
    let highestCompanyBlastOpIdNotSeen = -1;
    for (key in opScanned){
        if (!(opIdSeen.includes(key)) && (highestCompanyBlastScoreNotSeen < opScanned[key]["final"]) && opScanned[key]["blast"] != null && Date.now() > new Date(opScanned[key]["companyBlastInfo"]["blastDate"]).getTime()){
            highestCompanyBlastScoreNotSeen = opScanned[key]["final"];
            highestCompanyBlastOpIdNotSeen = key;
        }
    }

    if (highestCompanyBlastOpIdNotSeen != -1){
        opIdSeen.push(highestCompanyBlastOpIdNotSeen)
    }

    await updateFieldsOfRecord('user-info', recordId, {"op-ids-seen":opIdSeen.toString()}); // update user profile to add new oppurtunity in seen list
    res = [highestCompanyBlastOpIdNotSeen, opScanned[highestCompanyBlastOpIdNotSeen]];
    return(res);
}

async function attachOppurtunityInfoToRepyMessage(message, opID){
    let recordId = await searchUniqueValueToRetreiveRecordId('final-ops','op-id', opID);

    let [opName, imageURLS, text, date, descriptionURL, phone] = await retreiveValueFromRecord('final-ops', recordId, ['op-name', 'image-urls', 'text', 'date', 'description-url', 'phone']);
    
    if (imageURLS != null){
        imageURLS = imageURLS.split(",");
        for (x of imageURLS){
            message.media(x);
        }
    }  

    let body = "";

    if (phone != null){
        let recordassociatedUserId = await searchUniqueValueToRetreiveRecordId('user-info','phone', phone);
        let [name] = await retreiveValueFromRecord('user-info', recordassociatedUserId, ['name']);

        if(name != null){
            body += `This oppurtunity was submitted by ${name.trim()}!\n\n`;
        }
    }
    if (opName != null){
        body += opName + ": ";
    }
    else{
        body += "Oppurtunity Info:" ;
    }

    if (date != null){
        body += "\nOccuring or due on " + date + "!";
    }
    if (!(text == null || text == "")){
        body += "\nText: " + text;
    }
    if(descriptionURL != null){
        body += "\nHere is a description here: " + descriptionURL;
        console.log(descriptionURL);
    }
    return (body);
}

async function attachOppurtunityInfoToOutboundMessage(opID){
    let recordId = await searchUniqueValueToRetreiveRecordId('final-ops','op-id', opID);

    let [opName, imageURLS, text, date, descriptionURL, phone] = await retreiveValueFromRecord('final-ops', recordId, ['op-name', 'image-urls', 'text', 'date', 'description-url', 'phone']);
    
    if (imageURLS == null){
        imageURLS = [];
    }
    else{
        imageURLS = imageURLS.split(",");
    }

    let body = "";

    if (phone != null){
        let recordassociatedUserId = await searchUniqueValueToRetreiveRecordId('user-info','phone', phone);
        let [name] = await retreiveValueFromRecord('user-info', recordassociatedUserId, ['name']);

        if(name != null){
            body += `This oppurtunity was submitted by ${name.trim()}!\n`;
        }
    }
    if (opName != null){
        body += opName + ": ";
    }
    else{
        body += "Oppurtunity Info:" ;
    }

    if (date != null){
        body += "\nOccuring or due on " + date + "!";
    }
    if (!(text == null || text == "")){
        body += "\nText: " + text;
    }
    if(descriptionURL != null){
        body += "\nHere is a description here: " + descriptionURL;
    }
    return ([body, imageURLS]);
}


exports.findBestOp = findBestOp;
exports.findBestCompanyBlastOp = findBestCompanyBlastOp;
exports.attachOppurtunityInfoToOutboundMessage = attachOppurtunityInfoToOutboundMessage;
exports.updateFieldsOfRecord = updateFieldsOfRecord;
exports.attachOppurtunityInfoToRepyMessage = attachOppurtunityInfoToRepyMessage;