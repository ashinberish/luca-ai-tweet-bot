require("dotenv").config();
const admin = require("firebase-admin");
const serviceAccount = require(process.env.GOOGLE_APPLICATION_CREDENTIALS);
admin.initializeApp({
	credential: admin.credential.cert(serviceAccount),
});

// Database reference
const dbRef = admin.firestore().doc("/tokens/KkvU0gBRY5ShYovgiKCf");
const express = require("express");
const app = express();

const callbackURL = "https://luca-ai-tweet-bot.herokuapp.com/callback";

const { Configuration, OpenAIApi } = require("openai");
const configuration = new Configuration({
	organization: process.env.oaiorg,
	apiKey: process.env.oaikey,
});
const openai = new OpenAIApi(configuration);

const TwitterApi = require("twitter-api-v2").default;
const twitterClient = new TwitterApi({
	clientId: process.env.TCTID,
	clientSecret: process.env.TCTS,
});

app.get("/auth", async (request, response) => {
	const { url, codeVerifier, state } = twitterClient.generateOAuth2AuthLink(
		callbackURL,
		{ scope: ["tweet.read", "tweet.write", "users.read", "offline.access"] }
	);

	// store verifier
	await dbRef.set({ codeVerifier, state });

	response.redirect(url);
});

app.get("/callback", async (request, response) => {
	const { state, code } = request.query;

	const dbSnapshot = await dbRef.get();
	const { codeVerifier, state: storedState } = dbSnapshot.data();

	if (state !== storedState) {
		return response.status(400).send("Stored tokens do not match!");
	}

	const {
		client: loggedClient,
		accessToken,
		refreshToken,
	} = await twitterClient.loginWithOAuth2({
		code,
		codeVerifier,
		redirectUri: callbackURL,
	});

	await dbRef.set({ accessToken, refreshToken });

	const { data } = await loggedClient.v2.me(); // start using the client if you want

	response.send(data);
});

app.get("/tweet", async (request, response) => {
	const { refreshToken } = (await dbRef.get()).data();

	const {
		client: refreshedClient,
		accessToken,
		refreshToken: newRefreshToken,
	} = await twitterClient.refreshOAuth2Token(refreshToken);

	await dbRef.set({ accessToken, refreshToken: newRefreshToken });

	const nextTweet = await openai.createCompletion("text-davinci-001", {
		prompt: "tweet something cool for #techtwitter #tagforlikes",
		max_tokens: 64,
	});

	const { data } = await refreshedClient.v2.tweet(
		nextTweet.data.choices[0].text
	);

	response.send(data);
});

app.listen(process.env.PORT);
