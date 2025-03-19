const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const helmet = require('helmet');
require('dotenv').config();

// Load sample data for testing
let sampleFootballData = [];
let sampleTennisData = [];

try {
  const footballPath = path.join(__dirname, 'football.json');
  if (fs.existsSync(footballPath)) {
    sampleFootballData = JSON.parse(fs.readFileSync(footballPath, 'utf8'));
    console.log('Loaded sample football data');
  }
} catch (error) {
  console.error('Error loading sample football data:', error);
}

try {
  const tennisPath = path.join(__dirname, 'tennis.json');
  if (fs.existsSync(tennisPath)) {
    sampleTennisData = JSON.parse(fs.readFileSync(tennisPath, 'utf8'));
    console.log('Loaded sample tennis data');
  }
} catch (error) {
  console.error('Error loading sample tennis data:', error);
}

// Import utilities
const { 
  transformMainPageData, 
  transformMatchData, 
  transformOddsInplayData, 
  combineMatchAndOddsData,
  transformSportData,
  transformEventData 
} = require('./utils/dataTransformer');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' 
      ? process.env.PRODUCTION_FRONTEND_URL 
      : process.env.FRONTEND_URL,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? process.env.PRODUCTION_FRONTEND_URL 
    : process.env.FRONTEND_URL,
  credentials: true
}));
app.use(express.json());

// Session configuration with proper store for production
const sessionConfig = {
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
};

// Use a proper session store in production
if (process.env.NODE_ENV === 'production') {
  if (process.env.MONGODB_URI) {
    console.log('Using MongoDB session store');
    sessionConfig.store = MongoStore.create({
      mongoUrl: process.env.MONGODB_URI,
      touchAfter: 24 * 3600 // time period in seconds
    });
  } else {
    console.warn('No MONGODB_URI provided. Using FileStore for sessions. This is better than MemoryStore but still not ideal for production.');
    const FileStore = require('session-file-store')(session);
    sessionConfig.store = new FileStore({
      path: path.join(__dirname, 'data/sessions'),
      ttl: 86400
    });
  }
}

app.use(session(sessionConfig));

// Apply security headers
app.use(helmet());
app.use(helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:'],
    connectSrc: ["'self'", process.env.NODE_ENV === 'production' 
      ? process.env.PRODUCTION_FRONTEND_URL 
      : 'http://localhost:3000']
  }
}));

// User Management
const USERS_FILE_PATH = path.join(__dirname, 'data', 'users.json');
const MAX_DEVICES_PER_USER = 2;

// Create data directory if it doesn't exist
const ensureDataDirExists = async () => {
  const dataDir = path.join(__dirname, 'data');
  try {
    await fsPromises.mkdir(dataDir, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') {
      console.error('Error creating data directory:', err);
    }
  }
};

// Generate a random alphanumeric string
const generateRandomString = (length, includeUppercase = true) => {
  const characters = 'abcdefghijklmnopqrstuvwxyz0123456789' + 
                     (includeUppercase ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' : '');
  let result = '';
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
};

// Generate a random username starting with "user"
const generateRandomUsername = () => {
  return 'user' + generateRandomString(5, false);
};

// Generate a random password (6 digits, mix of letters and numbers)
const generateRandomPassword = () => {
  // Ensure at least one number and one letter
  const number = Math.floor(Math.random() * 10).toString();
  const letter = 'abcdefghijklmnopqrstuvwxyz'.charAt(Math.floor(Math.random() * 26));
  const upperLetter = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.charAt(Math.floor(Math.random() * 26));
  
  // Generate the remaining 3 characters
  const remaining = generateRandomString(3, true);
  
  // Combine and shuffle
  const combined = number + letter + upperLetter + remaining;
  return combined.split('').sort(() => 0.5 - Math.random()).join('').slice(0, 6);
};

// Load users from file or create initial users
const loadOrCreateUsers = async () => {
  await ensureDataDirExists();
  
  try {
    // Try to read existing users file
    const data = await fsPromises.readFile(USERS_FILE_PATH, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') {
      // File doesn't exist, create initial users
      const users = [];
      
      // Add admin user
      const adminSalt = await bcrypt.genSalt(10);
      const adminPassword = 'Infusion@810';
      const adminHashedPassword = await bcrypt.hash(adminPassword, adminSalt);
      
      users.push({
        id: 1,
        username: 'admin@infusion810',
        password: adminHashedPassword,
        plainPassword: adminPassword, // Store plain password for reference
        activeSessions: [],
        createdAt: new Date().toISOString()
      });
      
      // Create 10 random users
      for (let i = 0; i < 10; i++) {
        const username = generateRandomUsername();
        const password = generateRandomPassword();
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        
        users.push({
          id: i + 2, // Start from ID 2 since admin is ID 1
          username,
          password: hashedPassword,
          plainPassword: password, // Store plain password for admin reference
          activeSessions: [],
          createdAt: new Date().toISOString()
        });
      }
      
      // Save to file
      await fsPromises.writeFile(USERS_FILE_PATH, JSON.stringify(users, null, 2));
      console.log('Created initial users');
      return users;
    } else {
      console.error('Error loading users:', err);
      throw err;
    }
  }
};

// Save users to file
const saveUsers = async (users) => {
  await fsPromises.writeFile(USERS_FILE_PATH, JSON.stringify(users, null, 2));
};

// Global users variable
let users = [];

// Initialize users on startup
(async () => {
  try {
    users = await loadOrCreateUsers();
    console.log(`Loaded ${users.length} users`);
  } catch (err) {
    console.error('Failed to initialize users:', err);
  }
})();

// Middleware to authenticate JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ success: false, message: 'Access token required' });
  }
  
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, message: 'Invalid or expired token' });
    }
    
    req.user = user;
    next();
  });
};

// Login route
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  
  // Find user
  const user = users.find(u => u.username === username);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }
  
  // Check password
  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }
  
  // Check device limits
  if (user.activeSessions.length >= MAX_DEVICES_PER_USER) {
    return res.status(403).json({ 
      success: false, 
      message: `Maximum number of active devices (${MAX_DEVICES_PER_USER}) reached` 
    });
  }
  
  // Generate session ID
  const sessionId = generateRandomString(32);
  
  // Create token
  const token = jwt.sign(
    { id: user.id, username: user.username, sessionId }, 
    process.env.JWT_SECRET, 
    { expiresIn: '24h' }
  );
  
  // Add session to user's active sessions
  const userIndex = users.findIndex(u => u.id === user.id);
  const newSession = {
    sessionId,
    userAgent: req.headers['user-agent'] || 'Unknown',
    ipAddress: req.ip,
    createdAt: new Date().toISOString()
  };
  
  users[userIndex].activeSessions.push(newSession);
  await saveUsers(users);
  
  // Send response
  res.json({
    success: true,
    token,
    user: {
      id: user.id,
      username: user.username
    }
  });
});

// Logout route
app.post('/api/auth/logout', authenticateToken, async (req, res) => {
  const { sessionId } = req.user;
  
  // Find user
  const userIndex = users.findIndex(u => u.id === req.user.id);
  if (userIndex === -1) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }
  
  // Remove session
  users[userIndex].activeSessions = users[userIndex].activeSessions.filter(
    session => session.sessionId !== sessionId
  );
  
  await saveUsers(users);
  
  res.json({ success: true, message: 'Logged out successfully' });
});

// Get users (admin authentication is handled on frontend)
app.get('/api/admin/users', async (req, res) => {
  try {
    // Return users with plain passwords for admin reference
    res.json({
      success: true,
      users: users.map(user => ({
        id: user.id,
        username: user.username,
        plainPassword: user.plainPassword,
        activeSessions: user.activeSessions.length,
        createdAt: user.createdAt
      }))
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Add a new user (admin authentication is handled on frontend)
app.post('/api/admin/users', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Check if username already exists
    if (users.find(u => u.username === username)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Username already exists' 
      });
    }
    
    // Generate ID (max existing ID + 1)
    const id = Math.max(...users.map(u => u.id), 0) + 1;
    
    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    // Create new user
    const newUser = {
      id,
      username,
      password: hashedPassword,
      plainPassword: password, // Store plain password for admin reference
      activeSessions: [],
      createdAt: new Date().toISOString()
    };
    
    // Add to users array
    users.push(newUser);
    
    // Save to file
    await saveUsers(users);
    
    res.json({
      success: true,
      user: {
        id: newUser.id,
        username: newUser.username,
        plainPassword: newUser.plainPassword,
        activeSessions: 0,
        createdAt: newUser.createdAt
      }
    });
  } catch (err) {
    console.error('Error adding user:', err);
    res.status(500).json({ success: false, message: 'Failed to add user' });
  }
});

// Delete a user (admin authentication is handled on frontend)
app.delete('/api/admin/users/:id', async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    
    // Check if user exists
    const userIndex = users.findIndex(u => u.id === userId);
    if (userIndex === -1) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Remove user
    users.splice(userIndex, 1);
    
    // Save to file
    await saveUsers(users);
    
    res.json({ success: true, message: 'User deleted successfully' });
  } catch (err) {
    console.error('Error deleting user:', err);
    res.status(500).json({ success: false, message: 'Failed to delete user' });
  }
});

// Constants
const PORT = process.env.PORT || 7000;
const MAIN_API_URL = process.env.MAIN_API_URL || 'https://111111.info/pad=82/listGames';
const MATCH_API_URL = process.env.MATCH_API_URL || 'https://030586.live/api/bm_fancy';
const ODDS_INPLAY_API_URL = process.env.ODDS_INPLAY_API_URL || 'https://230586.live/oddsInplay';

// API base URLs
const API_BASE_URL = 'https://gobook9.com/api';
const AUTH_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJtZW1iZXJDb2RlIjoiQzEwMTAxMDJNMDkiLCJ0b2tlbklkIjoiZmMwYzY1ZTg0MTFlNDlhYTgwODgxYzQzYzRlODlhZTBiMmQxNTEyNzE0MGZiOTM4MTkxOTJjOWYzMGNmYmExNyIsImxvZ2luQ291bnRyeSI6IklOIiwic2Vzc2lvbklkIjoiOTdjOTg4OWJjMmVjNDg5NTc0MTEwYWQ2NGVhODI5YTNiMjhlYWYyNzUxNTlmNTkyNmE5OGMxNWRjYTBkOTQ3YiIsImFsbG93U2hha3RpUHJvIjpmYWxzZSwibGFzdExvZ2luVGltZSI6MTc0MjI2MjQ5NzY0NCwibmJmIjoxNzQyMjYyOTYxLCJsb2dpbk5hbWUiOiJkaXMuZGVtb2Q4IiwibG9naW5JUCI6IjE1Mi41OC4xOTIuNCIsInRoZW1lIjoibG90dXMiLCJleHAiOjE3NDI2MDg1NjEsImlhdCI6MTc0MjI2Mjk2MSwibWVtYmVySWQiOjUxMzcxMCwidXBsaW5lcyI6eyJDT1kiOnsidXNlcklkIjoxLCJ1c2VyQ29kZSI6ImFkbWluLnVzZXIifSwiU01BIjp7InVzZXJJZCI6NTEzMjk3LCJ1c2VyQ29kZSI6IkMxMDEifSwiTUEiOnsidXNlcklkIjo1MTM2OTEsInVzZXJDb2RlIjoiQzEwMTAxIn0sIkFnZW50Ijp7InVzZXJJZCI6NTEzNjk0LCJ1c2VyQ29kZSI6IkMxMDEwMTAyIn19LCJjdXJyZW5jeSI6IklOUiIsImlzRGVtbyI6dHJ1ZSwibWEiOm51bGwsImIiOm51bGwsInMiOm51bGwsImMiOm51bGx9.iaSo3mNYfeerZQXAFDYEP0vAJHIV4V8Ry4hmasxjlL0';

// Sport type IDs
const SPORT_TYPE_IDS = {
  cricket: '4',
  football: '1',
  tennis: '2'
};

// API request headers
const getHeaders = () => {
  return {
    'accept': 'application/json, text/plain, */*',
    'accept-language': 'en-US,en;q=0.9,en-IN;q=0.8',
    'authorization': AUTH_TOKEN,
    'content-type': 'application/json',
    'sec-ch-ua': '"Chromium";v="134", "Not:A-Brand";v="24", "Microsoft Edge";v="134"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0'
  };
};

// Get sport type ID from name
const getSportTypeId = (sportName) => {
  const normalizedName = sportName.toLowerCase();
  return SPORT_TYPE_IDS[normalizedName] || '4'; // Default to cricket if not found
};

// Helper for error handling in API requests
const apiRequest = async (url) => {
  try {
    const response = await axios.get(url, { headers: getHeaders() });
    return response.data;
  } catch (error) {
    console.error(`API request failed: ${url}`, error.message);
    return null;
  }
};

// Cache for sport data to reduce API calls
const sportsDataCache = {
  cricket: { data: null, timestamp: 0 },
  football: { data: null, timestamp: 0 },
  tennis: { data: null, timestamp: 0 }
};

// Cache for event data to reduce API calls
const eventDataCache = {};

// Cache TTL (5 minutes)
const CACHE_TTL = 5 * 60 * 1000;

// Routes
app.get('/api/sports', authenticateToken, async (req, res) => {
  try {
    const sports = [
      { id: 'cricket', name: 'Cricket', typeId: SPORT_TYPE_IDS.cricket },
      { id: 'football', name: 'Football', typeId: SPORT_TYPE_IDS.football },
      { id: 'tennis', name: 'Tennis', typeId: SPORT_TYPE_IDS.tennis }
    ];
    
    res.json({
      success: true,
      sports: sports
    });
  } catch (error) {
    console.error('Error fetching sports list:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch sports data' });
  }
});

// Get all matches for a sport
app.get('/api/sport/:sportName', authenticateToken, async (req, res) => {
  try {
    const { sportName } = req.params;
    const sportTypeId = getSportTypeId(sportName);
    const cacheKey = sportName.toLowerCase();
    
    // Check cache
    const now = Date.now();
    if (
      sportsDataCache[cacheKey] && 
      sportsDataCache[cacheKey].data && 
      now - sportsDataCache[cacheKey].timestamp < CACHE_TTL
    ) {
      // Return cached data
      return res.json(sportsDataCache[cacheKey].data);
    }
    
    // Fetch from API
    const sportData = await apiRequest(`${API_BASE_URL}/exchange/odds/eventType/${sportTypeId}`);
    
    if (!sportData) {
      return res.status(500).json({ 
        success: false, 
        message: `Failed to fetch ${sportName} data` 
      });
    }
    
    // Transform the data
    const transformedData = transformSportData(sportData, sportName);
    
    // Update cache
    sportsDataCache[cacheKey] = {
      data: transformedData,
      timestamp: now
    };
    
    res.json(transformedData);
  } catch (error) {
    console.error(`Error fetching ${req.params.sportName} data:`, error);
    res.status(500).json({ 
      success: false, 
      message: `Failed to fetch ${req.params.sportName} data` 
    });
  }
});

// Get details for a specific match/event
app.get('/api/event/:sportName/:eventId', authenticateToken, async (req, res) => {
  try {
    const { sportName, eventId } = req.params;
    const sportTypeId = getSportTypeId(sportName);
    const cacheKey = `${sportName}_${eventId}`;
    
    // Check cache
    const now = Date.now();
    if (
      eventDataCache[cacheKey] && 
      eventDataCache[cacheKey].data && 
      now - eventDataCache[cacheKey].timestamp < 10000 // 10 seconds for event data
    ) {
      // Return cached data
      return res.json(eventDataCache[cacheKey].data);
    }
    
    // Fetch from API
    const eventData = await apiRequest(`${API_BASE_URL}/exchange/odds/d-sma-event/${sportTypeId}/${eventId}`);
    
    if (!eventData) {
      return res.status(500).json({ 
        success: false, 
        message: `Failed to fetch event data for ${eventId}` 
      });
    }
    
    // Transform the data
    const transformedData = transformEventData(eventData, sportName);
    
    // Update cache
    eventDataCache[cacheKey] = {
      data: transformedData,
      timestamp: now
    };
    
    res.json(transformedData);
  } catch (error) {
    console.error(`Error fetching event data for ${req.params.eventId}:`, error);
    res.status(500).json({ 
      success: false, 
      message: `Failed to fetch event data for ${req.params.eventId}` 
    });
  }
});

// Socket.IO handling
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  
  if (!token) {
    return next(new Error('Authentication error'));
  }
  
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return next(new Error('Authentication error'));
    }
    
    socket.user = decoded;
    next();
  });
});

io.on('connection', (socket) => {
  console.log(`New client connected: ${socket.user.username}`);
  
  // Track active subscriptions for this socket
  const subscriptions = {
    sport: null,
    event: null
  };
  
  // Intervals for updates
  let sportUpdateInterval = null;
  let eventUpdateInterval = null;
  
  // Subscribe to a sport
  socket.on('subscribe_sport', async (sportName) => {
    console.log(`Client subscribed to sport: ${sportName}`);
    
    // Clear any existing sport interval
    if (sportUpdateInterval) {
      clearInterval(sportUpdateInterval);
    }
    
    // Set the new subscription
    subscriptions.sport = sportName;
    
    // Fetch and emit initial data
    const sportTypeId = getSportTypeId(sportName);
    const fetchAndEmitSportData = async () => {
      try {
        const sportData = await apiRequest(`${API_BASE_URL}/exchange/odds/eventType/${sportTypeId}`);
        
        if (sportData) {
          const transformedData = transformSportData(sportData, sportName);
          socket.emit('sport_update', transformedData);
        }
      } catch (error) {
        console.error(`Error fetching ${sportName} data for socket:`, error);
      }
    };
    
    // Fetch initial data
    await fetchAndEmitSportData();
    
    // Set up interval for updates (every 5 seconds)
    sportUpdateInterval = setInterval(fetchAndEmitSportData, 5000);
  });
  
  // Unsubscribe from a sport
  socket.on('unsubscribe_sport', () => {
    if (sportUpdateInterval) {
      clearInterval(sportUpdateInterval);
      sportUpdateInterval = null;
    }
    subscriptions.sport = null;
  });
  
  // Subscribe to an event
  socket.on('subscribe_event', async (data) => {
    const { sportName, eventId } = data;
    console.log(`Client subscribed to event: ${sportName}/${eventId}`);
    
    // Clear any existing event interval
    if (eventUpdateInterval) {
      clearInterval(eventUpdateInterval);
    }
    
    // Set the new subscription
    subscriptions.event = { sportName, eventId };
    
    // Fetch and emit initial data
    const sportTypeId = getSportTypeId(sportName);
    const fetchAndEmitEventData = async () => {
      try {
        const eventData = await apiRequest(`${API_BASE_URL}/exchange/odds/d-sma-event/${sportTypeId}/${eventId}`);
        
        if (eventData) {
          const transformedData = transformEventData(eventData, sportName);
          socket.emit('event_update', transformedData);
        }
      } catch (error) {
        console.error(`Error fetching event data for ${eventId} socket:`, error);
      }
    };
    
    // Fetch initial data
    await fetchAndEmitEventData();
    
    // Set up interval for updates (every 1 second)
    eventUpdateInterval = setInterval(fetchAndEmitEventData, 1000);
  });
  
  // Unsubscribe from an event
  socket.on('unsubscribe_event', () => {
    if (eventUpdateInterval) {
      clearInterval(eventUpdateInterval);
      eventUpdateInterval = null;
    }
    subscriptions.event = null;
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.user.username}`);
    
    if (sportUpdateInterval) {
      clearInterval(sportUpdateInterval);
    }
    
    if (eventUpdateInterval) {
      clearInterval(eventUpdateInterval);
    }
  });
});

// Serve static assets in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../frontend/build')));
  
  app.get('*', (req, res) => {
    res.sendFile(path.resolve(__dirname, '../frontend', 'build', 'index.html'));
  });
}

// Start the server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
  console.log(`Frontend URL: ${process.env.NODE_ENV === 'production' ? process.env.PRODUCTION_FRONTEND_URL : process.env.FRONTEND_URL}`);
}); 
