At frontend we have queryParams folderId , and using that folderId i will displaying unique content, and also each folderId
can give me a slackChannelId that i am sending from the frontend, so like let say user is first on folderId 1 and the slackChannelId let say x so the user chat gets send to the x and thread is created, and also incoming replies from that thread gets shown
to the user on the website i mean we make API request to chatwoot, and similarly let say user again msg so again it gets send to that slackChannelId coming from the frontend, but also to that thread that is created i think for that we need to track it or developer a system , i think by using redis for the moment being.

and now let say user goes to folderId 2 and the slackChannelId is y so the user messages get routed to that channel y and thread is
created and the replies from that thread simply gets rendered on that chat intferface, i mean simply snet to clickwoot, and again 
same thing, user msg back then we can get the slackChannelId from the req, and then also the thread which is created for him , 
i thinking from redis , and then msg send there via slack api  ...

so can you hlep me make the process efificent and error free, and optimze too ,