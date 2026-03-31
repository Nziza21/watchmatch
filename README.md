# WatchMatch

> One app. One movie. Zero arguments.

WatchMatch is a group movie recommendation web application that helps friends decide what to watch together. Each person in the group submits movies they love and votes on a mood for the night. WatchMatch analyzes everyone's taste, finds the overlap, and recommends the one movie that works for the whole group — along with where to watch it and a trailer.

---

## Live Demo

Access the app at: **https://nziza.tech**

- Landing page: `https://nziza.tech`
- App: `https://nziza.tech/app`

---

## The Problem It Solves

Every group movie night starts the same way — someone opens Netflix, scrolls for 30 minutes, and everyone ends up watching something nobody really wanted. WatchMatch fixes this by making the decision a group effort, not a guessing game.

Unlike Netflix recommendations (which are biased toward keeping you on their platform), WatchMatch has no agenda. It recommends based purely on what your group actually likes.

---

## Features

- Create a room and share a link with friends — no account needed
- Each person picks 2–3 movies they love and votes on a mood
- Mood options: Surprise me, Feel-good, Thrilling, Emotional, Mind-bending
- Mood voting is democratic — the majority wins and shapes the recommendation
- Real-time room updates — see who has joined and what mood they voted
- Minimum 2 people required before getting a recommendation
- When the creator clicks "Get Our Movie", the result appears on everyone's screen automatically
- "Not feeling it" button finds a different recommendation without starting over
- Watch the trailer directly inside the app
- Shows streaming platforms and a JustWatch link for your region
- Movie poster mosaic background built from real TMDB data
- Fully responsive — works on mobile and desktop

---

## Tech Stack

- **Backend:** Node.js + Express
- **Frontend:** HTML, CSS, JavaScript
- **Process Manager:** PM2
- **Load Balancer:** HAProxy
- **SSL:** Let's Encrypt

---

## API Used

### TMDB — The Movie Database
- Website: https://www.themoviedb.org
- Documentation: https://developer.themoviedb.org/docs
- Used for: movie search, genre data, recommendations, trailers, streaming providers, and movie poster images
- Free tier used — requires an API key from https://www.themoviedb.org/settings/api

> This product uses the TMDB API but is not endorsed or certified by TMDB.

---

## Running Locally

### Prerequisites
- Node.js v18 or higher
- A free TMDB API key from https://www.themoviedb.org/settings/api

### Steps
```bash
# Clone the repository
git clone https://github.com/Nziza21/watchmatch.git
cd watchmatch

# Install dependencies
npm install

# Create environment file
echo "TMDB_API_KEY=your_api_key_here" > .env

# Start the server
node server.js
```

Then open `http://localhost:3000` in your browser.

---

## Deployment

The app is deployed on two web servers with a load balancer in front.

### Infrastructure
- **web-01:** `44.201.158.142` — running WatchMatch on port 3000
- **web-02:** `3.85.90.63` — running WatchMatch on port 3000
- **lb-01:** `3.85.163.184` — HAProxy load balancer, handles SSL termination

### Deploying on Each Web Server
```bash
# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone the repo
git clone https://github.com/Nziza21/watchmatch.git
cd watchmatch
npm install
echo "TMDB_API_KEY=your_api_key_here" > .env

# Install PM2 and start the app
sudo npm install -g pm2
pm2 start server.js --name watchmatch
pm2 startup
pm2 save
```

### HAProxy Load Balancer Configuration

HAProxy is configured on lb-01 to distribute traffic between both web servers using round-robin load balancing. It also handles SSL termination using a Let's Encrypt certificate for `nziza.tech`.

`/etc/haproxy/haproxy.cfg`:
```haproxy
frontend https_front
    bind *:80
    bind *:443 ssl crt /home/ubuntu/nziza-tech.pem
    default_backend watchmatch_servers

backend watchmatch_servers
    balance roundrobin
    server web01 44.201.158.142:3000 check
    server web02 3.85.90.63:3000 check
```

### SSL Certificate

SSL is handled using Let's Encrypt via Certbot:
```bash
sudo certbot certonly --standalone -d nziza.tech -d www.nziza.tech
sudo bash -c 'cat /etc/letsencrypt/live/www.nziza.tech/fullchain.pem /etc/letsencrypt/live/www.nziza.tech/privkey.pem > /home/ubuntu/nziza-tech.pem'
```

---

## How Load Balancing Works

When a user visits `https://nziza.tech`, the request hits HAProxy on lb-01. HAProxy decrypts the SSL traffic and forwards the request to either web-01 or web-02 in round-robin order. Both servers run identical copies of the WatchMatch app managed by PM2, so the user experience is identical regardless of which server handles the request.

---

## Challenges

**Group result sync:** The biggest challenge was making sure all users in a room see the same recommendation at the same time. The solution was storing the result on the server once generated and using polling on the client side to detect when a result is ready, then automatically displaying it without any user action.

**Room locking:** Early versions allowed anyone to click "Get Our Movie" at any time, which caused different people to get different recommendations. Fixed by requiring a minimum of 2 people and storing the result server-side so everyone gets the same movie.

**SSL on HAProxy:** HAProxy requires the private key and certificate to be combined into a single PEM file. This was solved by concatenating the Let's Encrypt fullchain and private key files.

---

## Credits

- Movie data provided by [TMDB](https://www.themoviedb.org)
- Streaming availability powered by [JustWatch](https://www.justwatch.com)
- SSL certificate by [Let's Encrypt](https://letsencrypt.org)
- Fonts by [Google Fonts](https://fonts.google.com) — Inter

---

## Repository

https://github.com/Nziza21/watchmatch
