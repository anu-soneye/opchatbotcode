// Enviroment Variables
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const atapikey = process.env.AIRTABLE_API_KEY;
const atbaseid = process.env.AIRTABLE_BASE_ID;
const pkeyClientEmail = process.env.PKEY_CLIENT_EMAIL;
const pkeyPrivateKey = process.env.PKEY_PRIVATE_KEY;
const port_1 = process.env.PORT;

// Modules Required
const Airtable = require("airtable");

const client = require('twilio')(accountSid, authToken);
const { MessagingResponse } = require('twilio').twiml;

const { urlencoded } = require('body-parser');

const express = require('express');
const session = require('express-session');
const app = express();

const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];
const recFuncts = require("./recFunctions.js");
const pkey = require('./pkey.json');


// Phone Numbers I'm working with during testing
const tollfree_num = '+18447002833';

// Google From Question Id
const userInfoQuestionsToId = {"name":"7153f9e7", "major": "3f7b522a", "phone": "3e555b2b", "user-id": "17b7458e", "op-rec-reoccuring-basis": "4fbba237", "classification":"7dddd35c","send-company-blast":"78fa6735", "op-type-priority": {"1":"2d587324", "2":"6dfbddfb", "3": "0765f6b4",  "4": "55e6120a", "5": "324d59f6",  "6": "4f9c3828", "7":"3f8017ce"}, "op-feature-rec-priority": {"1": "458e9ec2", "2":"610b7491", "3": "1ec75cb2"}};
//const userInfoIdstoQuestions= {"7153f9e7":"name", "3f7b522a":"major", "3e555b2b":"phone","user-id": "17b7458e", "op-type-priority": {"1":"2d587324", "2":"6dfbddfb", "3": "0765f6b4",  "4": "55e6120a", "5": "324d59f6",  "6": "4f9c3828", "7":"3f8017ce"}, "op-feature-rec-priority": {"1": "458e9ec2", "2":"610b7491", "3": "1ec75cb2"}};
const opInfoQuestionsToId = {"description-url": "09d9619b", "date": "1babc2b8", "type": "2f92b8a3", "major": "320744c8", "phone": "3f7b522a", "op-id":"778b574a"};

// Responding to an incoming message
// Finite State Machine to have a flow of conversation
const fsmOverall = ["None", "Creating User Profile", "Op Submission", "Op Recommendation", "Error", "Setting Rec Schedule"];
const fsmOpSubmit = ["Choose Image, URL, or Text", "Sent Op information"];

// Middleware used to expose the body content of the incoming message
app.use(urlencoded({ extended: false })); 

// Middleware used to create a session where cookies about the user are retrained to have a flow of
app.use(session({
  secret: "kami", 
  saveUninitialized: true,
  resave:  true,
  cookie:{
    maxAge: 1000 * 60 * 4 // 4 minutes
}}));

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

async function insertNewUser(phoneNumber, newUserId){
    const base = new Airtable({
        apiKey: atapikey
        }).base(atbaseid);


    return new Promise((resolve, reject) => {
        base('user-info')
        .create([
            {   
                "fields":{
                    "phone": phoneNumber,
                    "user-id": newUserId,
                    "flows-used": "{}"
                }
            }
        ], function(err, records){
            if (err){
                reject(err)
            }
            resolve(0);
        });
    });
}

async function insertNewOp(phoneNumber, newOpId){
    const base = new Airtable({
        apiKey: atapikey
        }).base(atbaseid);


    return new Promise((resolve, reject) => {
        base('ops')
        .create([
            {   
                "fields":{
                    "phone": phoneNumber,
                    "op-id": newOpId
                }
            }
        ], function(err, records){
            if (err){
                reject(err)
            }
            resolve(0);
        });
    });
}

function errorMessageToUser(){
    let body = "Don't quite understand what you mean can you try retyping your message. If you're supposed to text me something please do or text 'exit' to do something else.";

    return body;
}

function sendsystemErrorToUser(client, phoneNumber){
    let body = "System error occured.";

    client.messages.create({
        body: body,
        to: phoneNumber, // Text your number
        from: tollfree_num, // From a valid Twilio number
      });
}

async function createUserId(){
    const userIdLength = 4;
    let newUserId = generateRandomID(userIdLength);
    let recordId = await searchUniqueValueToRetreiveRecordId("user-info","user-id", newUserId);
    while (recordId != -1){
        newUserId = generateRandomID(userIdLength);
        recordId = await searchUniqueValueToRetreiveRecordId("user-info","user-id", newUserId);
    }
    return (newUserId);
}

async function createOpId(){
    const opIdLength = 7;
    let newOpId = generateRandomID(opIdLength);
    let recordId = await searchUniqueValueToRetreiveRecordId("ops","op-id", newOpId);
    while (recordId != -1){
        newOpId = generateRandomID(opIdLength);
        recordId = await searchUniqueValueToRetreiveRecordId("ops","op-id", newOpId);
    }
    return (newOpId);
}

function getRndInteger(min, max) {
    return Math.floor(Math.random() * (max - min) ) + min;
}

function generateRandomID(length){
  let id = ""
  let letters = ["a", "b", "c", "d", "e", "f", "g", "h"];
  let nums = [1,2,3,4,5,6,7,8]
  for (let i = 0; i < length; i++){
    let letterOrNum = Math.round(Math.random());
    let j = getRndInteger(0,8);
    if (letterOrNum){
      id = id + letters[j];
    }
    else{
      id = id + nums[j];
    }
  }

  return (id);
}

async function isTokenValid(req, clientId, expectedServiceAccountEmail) {
    const bearer = req.header('Authorization');
    const [, token] = bearer.match(/Bearer (.*)/);
    const client = new OAuth2Client(clientId);
    try {
        const ticket = await client.verifyIdToken({
        idToken: token,
        audience: 'google-forms',
      });
      const claim = ticket.getPayload();
      return claim.email === expectedServiceAccountEmail && claim.email_verified;
    } catch (error) {
      return false;
    }
}

async function logUserInfoResponseToDatabase(formResponse){
    const submissionTime = formResponse.lastSubmittedTime;
    formResponse = formResponse.answers;
    // input google form responses to the database
    let recordID = await searchUniqueValueToRetreiveRecordId('user-info','phone', formResponse[userInfoQuestionsToId.phone].textAnswers.answers[0].value);
    if (recordID != -1){
        // Verifying that the user is valid (have correct userID and phone number)
        let [phoneNumber, userID] = await retreiveValueFromRecord('user-info', recordID, ['phone','user-id']);
        if (userID == formResponse[userInfoQuestionsToId["user-id"]].textAnswers.answers[0].value && formResponse[userInfoQuestionsToId.phone].textAnswers.answers[0].value == phoneNumber){
            let userProfileObject = {};
            userProfileObject.submissionTime = submissionTime;
            //valid so log all info into database
            for(const key in userInfoQuestionsToId){
                if (typeof userInfoQuestionsToId[key] === 'object'){
                    userProfileObject[key] = {};
                    for (const key_2 in userInfoQuestionsToId[key]){
                        userProfileObject[key][key_2] = formResponse[userInfoQuestionsToId[key][key_2]].textAnswers.answers[0].value;
                    }
                }
                else if(formResponse[userInfoQuestionsToId[key]] != null){
                    userProfileObject[key] = formResponse[userInfoQuestionsToId[key]].textAnswers.answers[0].value;
                }
            }
            await updateFieldsOfRecord('user-info', recordID, {"user-profile-object": JSON.stringify(userProfileObject), "name": userProfileObject.name, "major": userProfileObject.major, "op-rec-reoccuring-basis": userProfileObject["op-rec-reoccuring-basis"], "send-company-blast": userProfileObject["send-company-blast"], "classification": userProfileObject["classification"]}).catch((err) => console.err);
            return(recordID);
        }
        else{
            return(-1);
        }
    }
    else{
        return(-1);
    }
}

async function logOpInfoResponseToDatabase(formResponse){
    const submissionTime = formResponse.lastSubmittedTime;
    formResponse = formResponse.answers;
    // input google form responses to the database
    let recordID = await searchUniqueValueToRetreiveRecordId('ops','op-id', formResponse[opInfoQuestionsToId["op-id"]].textAnswers.answers[0].value);
    console.log(recordID);

    if (recordID != -1){
        // Verifying that the oppurtunity is valid (have correct opID and phone number)
        let [phoneNumber, opID, opProfileUpdateLast] = await retreiveValueFromRecord('ops', recordID, ['phone','op-id', "op-profile-update"]);
        console.log(phoneNumber, opID)
        if (opID == formResponse[opInfoQuestionsToId["op-id"]].textAnswers.answers[0].value && formResponse[opInfoQuestionsToId.phone].textAnswers.answers[0].value == phoneNumber){
            let opProfileObject = {};
            opProfileObject.submissionTime = submissionTime;
            console.log("Comparison: ", opProfileUpdateLast, submissionTime);
            console.log(opProfileUpdateLast == submissionTime);
            if (opProfileUpdateLast == submissionTime){
                return(-1);
            }
            //valid so log all info into database
            for(const key in opInfoQuestionsToId){
                if (typeof opInfoQuestionsToId[key] === 'object'){
                    opProfileObject[key] = {};
                    for (const key_2 in opInfoQuestionsToId[key]){
                        opProfileObject[key][key_2] = formResponse[opInfoQuestionsToId[key][key_2]].textAnswers.answers[0].value;
                    }
                }
                else if(formResponse[opInfoQuestionsToId[key]] != null){
                    if (key == "type" || key == "major"){
                        let multipleSelect = [];
                        for(x of formResponse[opInfoQuestionsToId[key]].textAnswers.answers){
                            multipleSelect.push(x["value"]);
                        }
                        opProfileObject[key] = multipleSelect;
                    }
                    else{
                        opProfileObject[key] = formResponse[opInfoQuestionsToId[key]].textAnswers.answers[0].value;
                    }
                }
                else{
                    opProfileObject[key] = null;
                }
            }
            console.log(opProfileObject);
            await updateFieldsOfRecord('ops', recordID, {"op-profile-object": JSON.stringify(opProfileObject), "description-url": opProfileObject["description-url"], "major": opProfileObject.major, "date": opProfileObject.date, "type": opProfileObject.type}).catch((err) => console.err);

            return(recordID);
        }
        else{
            return(-1);
        }
    }
    else{
        return(-1);
    }
}

async function retreiveRecentFormRespsonses(formID, zuluTime){
    const jwtClient = new google.auth.JWT(
        pkey.client_email,
        null,
        pkey.private_key,
        ["https://www.googleapis.com/auth/forms.responses.readonly"]
      );

    await jwtClient.authorize();
    
    const forms = google.forms({
        version: 'v1',
        auth: jwtClient,
    });
    
    let fewSecondsBeforeTime = new Date(new Date(zuluTime).getTime() - 1000 * 120); // subtract 50 seconds
    console.log(zuluTime);
    console.log(fewSecondsBeforeTime);
    const res = await forms.forms.responses.list({formId: formID, filter: 'timestamp >= ' + fewSecondsBeforeTime.toISOString()});
    return (res);
}


// Main logic to reply any text message from the user
app.post('/sms-reply', async (req, res) => {
  const twiml = new MessagingResponse();
  const message = twiml.message();
  const fsmOverallCount = req.session.fsmOverall || 0;
  const fsmOpSubmitCount = req.session.fsmOpSubmit || 0;

  res._keepAliveTimeout = 7000; // time till the socket dies (5 seconds for now)

  let recordId = await searchUniqueValueToRetreiveRecordId("user-info","phone", req.body.From).catch((error) => sendsystemErrorToUser(client, req.body.From));
  const userMessage = (req.body.Body).trim().toLowerCase();

  let body = "";
  let secondMessageBody = "";
  // New User
  if (recordId == -1){
    let newUserId = await createUserId();
    await insertNewUser(req.body.From, newUserId).catch((error) => console.error);

    body = "Hi, I'm CC! As a Crowdsourced Chatbot (CC), I receive any opportunities from you and other students in CEA through either a screenshot or a URL link, collect them, and then recommend opportunities made for you based on attributes such as your major, interests, and more.\n\nThe more high-quality opportunities you submit, the more points you get! The top 2 students who with the highest number of points win a $50 bookstore voucher. The leaderboard will be updated weekly at my website. \n\n  This chatbot was made by the HUB within CEA Student's Council, follow us on insta!: https://www.instagram.com/huceahub/"
    message.body(body);
    res.type('text/xml').send(twiml.toString());

    body = "To begin using me, you can . . . \n \n(1) text 'new user profile' to help me find better opportunities for you. You are not obligated to make a user profile but I will work better for you this way. \n(2) text 'submit' to start submitting your first opportunity to my database. \n(3) text 'rec' to receive a recommendation whenever you want. \n(4) text 'set rec schedule' to set when you would want recommendations automatically sent to you\n(5) text 'list all' to see all the oppurtunties I have. \n\n To learn more about how I work or view the leaderboard visit: https://anu-soneye.github.io/opchatbotweb/ ";
    client.messages.create({
        body: body,
        to: req.body.From, // Text your number
        from: tollfree_num, // From a valid Twilio number
    }).catch((err) => sendsystemErrorToUser(client, req.body.From));

    req.session.fsmOverall = 0;
  }
  else{
    let [flowsUsed] = await retreiveValueFromRecord('user-info', recordId, ["flows-used"]);
    flowsUsed = JSON.parse(flowsUsed);
    // Initiating a new flow for a user based on what they want to do
    if (userMessage == "exit"){
        req.session.fsmOverall = 0;
        body = "Exited. Text me 'submit' to begin submitting a new oppurtunity or 'rec' to receive a recommendation";
        message.body(body);
        res.type('text/xml').send(twiml.toString()); 
    }
    else if (userMessage == "hi" || userMessage == 'hey' || userMessage == "hello"){
        body = "Hi, I'm CC! To begin using me, you can . . .  \n \n(1) text 'new user profile'\n(2) text 'submit' to start submitting an opportunity \n(3) text 'rec' to receive a recommendation \n(4) text 'set rec schedule' \n(5) text 'list all' to see all the oppurtunties I have. \n\n To learn more about how I work or view the leaderboard visit: https://anu-soneye.github.io/opchatbotweb/";
        message.body(body);
        res.type('text/xml').send(twiml.toString()); 
    }
    else if(fsmOverallCount == 0 || fsmOverallCount == 4){
        if (userMessage.includes("user profile") || userMessage == "profile" || userMessage=== "new profile"){
            req.session.fsmOverall = 1; // creating new user profile
            let [userId] = await retreiveValueFromRecord("user-info", recordId, ["user-id"]);

            if (flowsUsed.sentProfileCreation == null){
                body = "Ok, to get to know you a little more, could you fill out this google form: " + `https://docs.google.com/forms/d/e/1FAIpQLSeGUM_8rT4SrLWlhf7zIvxJXeboWkgIs2-aRyU9OCP7UNDT4A/viewform?usp=pp_url&entry.1045781291=%2B${req.body.From.slice(1)}&entry.397886862=${userId}`
                secondMessageBody = "Please don't change the pre-filled information in the form or else your user profile will not work correctly. You can change your profile by updating the google form you submitted or texting 'profile' again." + `\n\nFor future reference, your unique User ID is ${userId}. Don't share with anyone.`;
                flowsUsed.sentProfileCreation = "true";
            }
            else{
                body = "You can update your profile here: " + `https://docs.google.com/forms/d/e/1FAIpQLSeGUM_8rT4SrLWlhf7zIvxJXeboWkgIs2-aRyU9OCP7UNDT4A/viewform?usp=pp_url&entry.1045781291=%2B${req.body.From.slice(1)}&entry.397886862=${userId}`;
            }
            req.session.fsmOverall = 0; // back to 'none' state;
        }   
        else if(userMessage.includes("new submission") || userMessage.includes("submit") ){
            req.session.fsmOverall = 2; // submitting a new oppurtunity
            if (flowsUsed.sentNewSubmissionDetails == null){
                body = "Cool, you can send me one or multiple screenshots/images (preferred), a URL link, or a short description in text. Text 'image', 'url, or 'text' for a description to begin.";
            }
            else{
                body = "Cool, just send me one or multiple images or text a description or url of the opportunity.";
                req.session.fsmOpSubmit = 1;
            }
        }
        else if (userMessage == "deal me one" || userMessage == "serve" || userMessage == "serve one" || userMessage == "serve me one" || userMessage == "rec" || userMessage == "rec?"|| userMessage == "anything"){
            req.session.fsmOverall = 3; // retreiving a recommended oppurtunity
            let [opID, breakdown] = await recFuncts.findBestOp(req.body.From);
            if (opID == -1){
                body = "Seems you seen all the oppurtunties we have, feel free to submit more for other to discover!"
            }
            else{
                let max = 0;
                let reason = "for no particular reason ^_^";
                for (key in breakdown){
                    if (breakdown[key] > max && key != "final"){
                        max = breakdown[key] ;
                        if (key == "major"){
                            reason = "mainly due to your major!";
                        }
                        else if(key == "time"){
                            reason = "mainly because it's occuring or due soon!";
                        }
                        else if (key == "type"){
                            reason = "mainly due to the type of oppurtunty!"
                        }
                        else{
                            reason = `mainly due to the ${key}* feature.`;
                        }
                    }
                }
                let body_2 = await recFuncts.attachOppurtunityInfoToRepyMessage(message, opID);
                body = "Here is one recommended to you " + reason + " " +  body_2;
            }
            req.session.fsmOverall = 0; // back to none state
        }
        else if(userMessage == "list all" || userMessage == "list" || userMessage == "all"){
            body = "List of all verified oppurtunies can be seen here, but if you view this link on a larger screen then you can filter to see what you want: " + "https://airtable.com/appElwr4sUAMoA5ig/shr63OPIoT7WL1UyY";
        }
        else if (userMessage == "set rec schedule" || userMessage == "set rec" || userMessage == "set rec sched"){
            body = "Would you want opportunites sent to you daily, weekly, or biweekly?";
            req.session.fsmOverall = 5; // back to none state
        }
        else{
            req.session.fsmOverall = 4; // error
            body = errorMessageToUser();
        }   
        message.body(body);
        res.type('text/xml').send(twiml.toString()); 
    }
    else if (fsmOverallCount == 5) {
        let recSched = "Biweekly";
        if(userMessage == "daily"){
            recSched = "Daily";
        }
        else if (userMessage == "weekly"){
            recSched = "Weekly";
        }

        await updateFieldsOfRecord('user-info', recordId, {"op-rec-reoccuring-basis": recSched}).catch((err)=> console.err());

        body = "Cool, just changed your rec schedule to be " + userMessage;
        message.body(body);
        res.type('text/xml').send(twiml.toString());
    }
    else{
        if (fsmOverallCount == 2){
            if (fsmOpSubmitCount == 1){
                let newOpId = await createOpId();
                await insertNewOp(req.body.From, newOpId).catch((error) => console.error);

                let mediaLinks = [];
                if (req.body.NumMedia > 0){ 
                    for (let i = 0; i < req.body.NumMedia; i++){
                        mediaLinks.push(req["body"][`MediaUrl${i}`]);
                    }
                }
                let opRecordId = await searchUniqueValueToRetreiveRecordId('ops', 'op-id', newOpId);
                await updateFieldsOfRecord('ops', opRecordId, {"image-urls": mediaLinks.toString(), "text": req.body.Body}).catch((err) => console.err);
                body = "Received! To add more information about the opportunity please fill out the form I linked and don't change the pre-filled information. \n\nYou may fill it out later on but this information is vital for my recommendation algorithm, so don't leave me hanging. \n" + `https://docs.google.com/forms/d/e/1FAIpQLSfBD0q-JYT32rC14DiuwWglpNtHV4NKLDJaLGiTfqzDUgUxmw/viewform?usp=pp_url&entry.1065046570=%2B${req.body.From.slice(1)}&entry.2005620554=${newOpId}`;            
                req.session.fsmOverall = 0;
                flowsUsed.sentNewSubmissionDetails = "true";
            }
            else if (flowsUsed.sentNewSubmissionDetails == null && (userMessage.includes("image") || userMessage.includes("shot"))){
                req.session.fsmOpSubmit = 1; // choosing submission form
                req.session.opFormat = "image";
                body = "Ok, you can send me a message with one or multiple screenshots attached. No need to add any text unless you want to add a short description.";
            }
            else if (flowsUsed.sentNewSubmissionDetails == null && (userMessage.includes("url") || userMessage.includes("link"))){
                req.session.fsmOpSubmit = 1; // choosing submission form
                req.session.opFormat = "url";
                body = "Ok, you can send me a message with just a URL.";
            }
            else if (flowsUsed.sentNewSubmissionDetails == null && (userMessage.includes("text") || userMessage.includes("description"))){
                req.session.fsmOpSubmit = 1; // choosing submission form
                req.session.opFormat = "text";
                body = "Ok, you can send me a message with a short description of the opportunity. If you want to send anything longer than 100 characters then please send me a screenshot. I'll send you a google form after you send me the oppurtnunity where you can insert a long form description through the form of a Google Doc sharable link.";
            } 
            else{
                body = errorMessageToUser();
            }
        }
        else{
            body = errorMessageToUser();
        }
        message.body(body);
        res.type('text/xml').send(twiml.toString());
    }

    await updateFieldsOfRecord('user-info', recordId, {"flows-used": JSON.stringify(flowsUsed)}).then(()=> console.log(flowsUsed));
  }

  if (secondMessageBody != ""){
    client.messages.create({
        body: secondMessageBody,
        to: req.body.From, // Text your number
        from: tollfree_num, // From a valid Twilio number
    }).catch((err) => sendsystemErrorToUser(client, req.body.From));
  }
  
  console.log("FSM Overall Const: ", fsmOverallCount);
  console.log("FSM Overall Session: ", req.session.fsmOverall);

  console.log("FSM Submit Const: ",fsmOpSubmitCount);
  console.log("FSM Submit Sesion: ",req.session.fsmOpSubmit);

  console.log("FSM opFormat: ",req.session.opFormat);

});
    
app.use(express.json());
  

// Response to whenever a user submits user profile google form
app.post('/pubsub-userinfo', async (req, res) => {
    const clientId = '919471927932-nu9nml9p2l386cl1kq6tef8o07boluiv.apps.googleusercontent.com';
    const expectedServiceAccountEmail = 'op-chatbot-personal@op-chatbot-401315.iam.gserviceaccount.com';
    const isValid = await isTokenValid(req, clientId, expectedServiceAccountEmail);
    if (!isValid) {
        console.log("Error!");
        return res.sendStatus(403);
    }

    console.log("VALID");
    let formRes = await retreiveRecentFormRespsonses(req.body.message.attributes.formId, req.body.message.publishTime);
    console.log("RECENT RESPONSES");
    let recordsUpdated = []
    for (let i = 0; i < formRes.data.responses.length; i++){
        console.log("RESPONSE: " + formRes.data.responses[i]);
        let recordUpdated = await logUserInfoResponseToDatabase(formRes.data.responses[i])
        recordsUpdated.push(recordUpdated);
    }

    for (let i = 0; i < recordsUpdated.length; i++){
        if(recordsUpdated[i] != -1){
            let [userProfile, userProfileUpdate] = await retreiveValueFromRecord('user-info', recordsUpdated[i], ["user-profile-object","user-profile-update"]);
            userProfile = JSON.parse(userProfile);

            if (userProfile.submissionTime != userProfileUpdate){
                await updateFieldsOfRecord('user-info', recordsUpdated[i], { "user-profile-update": userProfile.submissionTime }).catch((error) => console.error);
                client.messages.create({
                    body: `We received your user profile submitted on ${(new Date(userProfile.submissionTime)).toString().slice(16)}. Thank you! \n\nText 'profile' anytime you want to update your profile, 'submit' to submit a new oppurtunity to my database, or 'rec' to receive an oppurtunity recommendation.`,
                    to: userProfile.phone, // Text your number
                    from: tollfree_num, // From a valid Twilio number
                }).catch((err) => sendsystemErrorToUser(client, req.body.From));
            }
        }
    }
    res.sendStatus(200);
});


// Response to whenever a user submits oppurtuntiy additional info through google form
app.post('/pubsub-opinfo', async (req, res) => {
    const clientId = '919471927932-nu9nml9p2l386cl1kq6tef8o07boluiv.apps.googleusercontent.com';
    const expectedServiceAccountEmail = 'op-chatbot-personal@op-chatbot-401315.iam.gserviceaccount.com';
    const isValid = await isTokenValid(req, clientId, expectedServiceAccountEmail);
    if (!isValid) {
        console.log("Error!");
        return res.sendStatus(403);
    }

    let formRes = await retreiveRecentFormRespsonses(req.body.message.attributes.formId, req.body.message.publishTime);
    let recordsUpdated = []
    console.log("=> : ", formRes.data.responses);
    if (formRes.data.responses == null){
        console.log("Error!");
        return res.sendStatus(403);
    }
    for (let i = 0; i < formRes.data.responses.length; i++){
        console.log("RESPONSE: " + formRes.data.responses[i]);
        let recordUpdated = await logOpInfoResponseToDatabase(formRes.data.responses[i]);
        recordsUpdated.push(recordUpdated);
    }

    for (let i = 0; i < recordsUpdated.length; i++){
        if(recordsUpdated[i] != -1){
            let [opProfile, opProfileUpdate] = await retreiveValueFromRecord('ops', recordsUpdated[i], ["op-profile-object","op-profile-update"]);
            opProfile = (opProfile !=  null) ? JSON.parse(opProfile) : {};


            if (opProfile.submissionTime == null || opProfile.submissionTime != opProfileUpdate){
                await updateFieldsOfRecord('ops', recordsUpdated[i], { "op-profile-update": opProfile.submissionTime }).catch((error) => console.error);
                client.messages.create({
                    body: `We received additional information about the opportunity submitted on ${(new Date(opProfile.submissionTime)).toString()}. Thank you!\n\nText 'profile' anytime you want to update your profile, 'submit' to submit a new oppurtunity to my database, or 'rec' to receive an oppurtunity recommendation.`,
                    to: opProfile.phone, // Text your number
                    from: tollfree_num, // From a valid Twilio number
                }).catch((err) => sendsystemErrorToUser(client, req.body.From));
            }
        }
    }
    res.sendStatus(200);
});

// Host on port defined in enviroment variables
const port = parseInt(port_1) || 3000; //8080;

app.listen(port, () => {
  console.log(`helloworld: listening on port ${port}`);
});




