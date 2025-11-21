# Description: 

All AI prompts I wrote to assist with building this project are shown below. I used Gemini 3 Pro (released yesterday!) to help with planning & broad overview tasks, and used Claude Sonnet 4.5 & GPT-5.1-Codex-Max as agents through Cursor & Codex for code assistance. 

# Prompts: 

I am working on building a type of AI-powered application on Cloudflare. It will use an LLM, workflow/coordination, user input via chat or voice, and memory or state. I want you to help me brainstorm some potential application ideas.
A good AI-powered application is:
1. Innovative. I don't want to do something that has been done many times before. I want to create an applicatoin that is innovative in some way.
2. Useful. I want it to provide some sort of value to the user and not simply be for demonstration purposes.
Brainstorm 5-10 ideas of potential AI-powered applications and write a concise paragraph detailing each one.

I want you to mock a file structure for this project. There should be a frontend folder named public/ and a backend folder named src/. 

Let's work on creating an MVP for Prism AI. Based on the file structure I provided, I want you to generate the following files: 
1. wrangler.toml: This file tells Cloudflare to enable Workers AI and provision the Durable Object database. 
2. src/index.ts: This file contains both the Worker and the Durable Object. Add a header so that I should be able to call this API from the frontend. 

I have provided the Cloudflare documentation for your reference. [attached .txt file of manually complied Cloudflare documentation]

I am getting the following error when attempting to generate a color Palette: Error connecting to AI: TypeError: Cannot read properties of undefined (reading 'forEach'). Explain the error and make the necessary changes to @index.ts and @index.html

There is a problem with the history. As soon as a new color gradient is generated, the previous color dissapears in the history. Diagnose the issue and make the necessary changes. 

The algorithm currently only factors in one color out of the 5 in order to generate the gradient. I want you to change the algorithm to create the gradient using all 5 of the colors returned by the LLM.

I want you to help me create a comprehensive README.md for this project. Here is an overview of the sections and what they should contain, expand on these and format properly:
1. Description: A short concise description of the project
2. Sample outputs: I will add screenshots of sample outputs of the application, just make the section. 
3. Architecture: Include details about how the backend uses cloudflare workers, LLM is llama-3.3, durable object memory for palette history, frontend(html/css/js)
4. Prerequisites (Node.js, npm, cloudflare account)
5. Installation: Clone repo, install dependencies, starting dev server
6. Features: More comprehensive list of the features, expand on the description. 
Keep it simple and concise. Do not use any emojis. 