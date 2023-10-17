# opchatbotcode
Chatbot the can send students opportunties meant for them with the Twilio API, Google Forms API, and Airtable.

For CEA students, feel free to build on top of this chatbot to add any feature you desire! Just submit a pull request and we'll review it.
Currently, we're keeping the database private but you can make your own fake database in Airtable for testing you're newly added code, so for now
email howardceahub@gmail.com and cc anuoluwapo.soneye@bison.howard.edu if you want more information.

For now here is a google doc of some notes utilized when testing this code (only HU emails can view): 
https://docs.google.com/document/d/1FCta6W_-QHg-zeajSPcMJcrsvSgNHgf0fLXtCmUOqCY/edit?usp=sharing

Information about files:
- package.json files and Procfile are both for buliding the a container to host on gcloud (intiate text code is under gcloud jobs - runs 8 am every day and chatbotreply is under gcloud services)
- main code is in index.js for both