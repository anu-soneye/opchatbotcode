// Enviroment Variables
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const atapikey = process.env.AIRTABLE_API_KEY;
const atbaseid = process.env.AIRTABLE_BASE_ID;

// Modules Required
const Airtable = require("airtable");
const recFuncts = require("./recFunctions.js");

const tollfree_num = '+18447002833';

async function sendRecommendationsToAllUsers(){
    const client = require('twilio')(accountSid, authToken);

    const base = new Airtable({
        apiKey: atapikey
        }).base(atbaseid);

        return (new Promise((resolve, reject) => {
        base('user-info').select({
            view: "Grid view"
        }).eachPage(function page(records, fetchNextPage) {
            // This function (`page`) will get called for each page of records.
        
            records.forEach(async function(record) {
                let phone = record.get("phone");
                let lastOpRecTime = record.get("time-of-last-sent-op-rec");
                let opRecBasis = record.get("op-rec-reoccuring-basis");
                let sendCompanyBlast = record.get("send-company-blast");
                let pushRec = false;

                console.log(phone);
                console.log(opRecBasis);
                console.log(lastOpRecTime);
                if (phone != null){
                if (opRecBasis != null){
                    if (lastOpRecTime != null){
                        comparisonTime = new Date(lastOpRecTime);
                        if (opRecBasis == "Daily"){
                            comparisonTime.setDate(comparisonTime.getDate() + 1);
                        }
                        else if (opRecBasis == 'Weekly'){
                            comparisonTime.setDate(comparisonTime.getDate() + 7);
                        }
                        else{ // biweekly
                            comparisonTime.setDate(comparisonTime.getDate() + 2 * 7);
                            opRecBasis = "Biweekly";
                        }

                        if (Date.now() >= comparisonTime){
                            pushRec = true;
                        }
                    }
                    else{
                        pushRec = true;
                    }
                }

                console.log(pushRec);
                if (pushRec){
                    let [opID, breakdown] = await recFuncts.findBestOp(phone);
                    let body_2 = "";
                    let imageURLS = [];
                    console.log(opID);
                    console.log(breakdown);
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
                        [body_2, imageURLS] = await recFuncts.attachOppurtunityInfoToOutboundMessage(opID);
                        body = "Got your " + opRecBasis.toLowerCase() + " dose of oppurtunities for you! Here is one recommended " + reason + "\n\n" + body_2;          
                        
                        console.log(body);
                        console.log(imageURLS);

                        let testDate = new Date();
                        testDate.setMinutes(0,0,0);
    
                        await recFuncts.updateFieldsOfRecord("user-info", record.id, {"time-of-last-sent-op-rec": testDate.toISOString()});
                    }

                    client.messages.create({
                        body: body,
                        to: phone, // Text your number
                        from: tollfree_num, // From a valid Twilio number
                        mediaUrl: imageURLS})
                        .then(function (message){
                        console.log(message.sid);
                        console.log(message.status);
                    });

                    if (sendCompanyBlast == "Yes"){
                        imageURLS = [];
                        [opID, imageURLS] = await recFuncts.findBestCompanyBlastOp(phone);
                        if (opID != -1){
                            [body_2, imageURLS] = await recFuncts.attachOppurtunityInfoToOutboundMessage(opID);
                            body = "Ayye! We got a company blast for you as well! \n\n" + body_2;

                            client.messages.create({
                                body: body,
                                to: phone, // Text your number
                                from: tollfree_num, // From a valid Twilio number
                                mediaUrl: imageURLS,
                            })
                            .then(function (message){
                            console.log(message.sid);
                            console.log(message.status);
                            });
                            let tempDate = new Date();
                            tempDate.setHours(0, 0, 0, 0);
                            await recFuncts.updateFieldsOfRecord("user-info", record.id, {"time-of-last-sent-op-rec": tempDate.toISOString()});
                        }
                    }
                    }
                }
            });
        
            // To fetch the next page of records, call `fetchNextPage`.
            // If there are more records, `page` will get called again.
            // If there are no more records, `done` will get called.
            fetchNextPage();
            resolve(0);
        
        }, function done(err) {
            if (err) { console.error(err); reject(err); }
        });
    }));
}

sendRecommendationsToAllUsers().catch(err => {
    console.error(err);
    process.exit(1);
});
