import express from 'express';
import mongoose from 'mongoose';
import 'dotenv/config'
import bcrypt from 'bcrypt';
import { nanoid } from 'nanoid';
import jwt from 'jsonwebtoken';
import cors from 'cors';
// import admin from "firebase-admin";
// import serviceAccountKey from "./fathership-fyp-firebase-adminsdk-fbsvc-71decfb46e.json" with { type: "json" }
// import { getAuth } from "firebase-admin/auth";
import aws from "aws-sdk";
import { GoogleGenAI } from "@google/genai";

// schema below
import User from './Schema/User.js';
import Blog from './Schema/Blog.js';
import Notification from "./Schema/Notification.js";
import Comment from "./Schema/Comment.js";
import Activity from './Schema/Activity.js';
import Category from './Schema/Category.js';
import Report from './Schema/Report.js';
import Ban from './Schema/Ban.js';
import Community from './Schema/Community.js';
import Post from './Schema/Post.js';
import geminiPrompt from './ai-model-prompt.js';

const server = express();
let PORT = 3000;

// admin.initializeApp({
//     credential: admin.credential.cert(serviceAccountKey)
// })

const ai = new GoogleGenAI(process.env.GEMINI_API_KEY);

let emailRegex = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/; // regex for email
let passwordRegex = /^(?=.*\d)(?=.*[a-z])(?=.*[A-Z]).{6,20}$/; // regex for password

server.use(cors({
  origin: 'https://bright-salmiakki-130fdf.netlify.app',
  credentials: true
}))

// server.use(cors());

server.use(express.json())

server.options('*', cors()) // handle preflight requests

mongoose.connect(process.env.DB_LOCATION, {
    autoIndex: true
})

// setting up s3 bucket
const s3 = new aws.S3({
    region: process.env.AWS_BUCKET_REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
})

const generateUploadURL = async () => {

    const date = new Date();
    const imageName = `${nanoid()}-${date.getTime()}.jpeg`;

    return await s3.getSignedUrlPromise('putObject', {
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: imageName,
        Expires: 1000,
        ContentType: "image/jpeg"
    })

}

const verifyJWT = (req, res, next) => {

    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(" ")[1];

    if(token == null){
        return res.status(401).json({ error: "No access token" })
    }

    jwt.verify(token, process.env.SECRET_ACCESS_KEY, async (err, user) => {
        if(err) {
            return res.status(403).json({ error: "Access token is invalid" })
        }

        // check user id in db
        const userDoc = await User.exists({ _id: user.id });

        if(!userDoc){ return res.status(403).json({ error: "No user found" }) }
        
        req.user = user.id
        req.super_admin = user.super_admin;

        next()
    })

}

const formatDatatoSend = (user) => {

    const access_token = jwt.sign({ id: user._id, super_admin: user.super_admin }, process.env.SECRET_ACCESS_KEY)

    return {
        access_token,
        profile_img: user.personal_info.profile_img,
        username: user.personal_info.username,
        fullname: user.personal_info.fullname,
        super_admin: user.super_admin,
        birthdate: user.personal_info.birthdate,
        gender: user.personal_info.gender,
        interests: user.personal_info.interests
    }
}

const generateUsername = async (email) => {
    let username = email.split("@")[0];

    let isUsernameNotUnique = await User.exists({ "personal_info.username": username })

    isUsernameNotUnique ? username += nanoid().substring(0, 5) : "";

    return username;

}

const logActivity = async (user, type, action, link, content, ref, parent_ref = null, blog_ref = null) => {

    // save the doc
    const activity = new Activity({
        user, type, action, link, content, ref, parent_ref, blog_ref
    })

    await activity.save();

    console.log('New Activity Logged..')

}

// get age range

const getAgeRange = (birthdate) => {
    //  Calculate age
    let age = "all";
    if (birthdate) {
        const birthday = new Date(birthdate);
        const today = new Date();

        if (birthday > today) {
            return res.status(400).json({ error: "Invalid birthdate" });
        }

        const ageInNumber = today.getFullYear() - birthday.getFullYear();
        const monthDiff = today.getMonth() - birthday.getMonth();
        const dayDiff = today.getDate() - birthday.getDate();

        const actualAge =
            monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)
                ? ageInNumber - 1
                : ageInNumber;

        age = actualAge;
    }

    //  Build age range logic
    let ageRanges = ["all"]; // always include "all"
    if (age !== "all") {
        if (age >= 13 && age <= 17) ageRanges.push("13-17");
        else if (age >= 18 && age <= 25) ageRanges.push("18-25");
        else if (age >= 26 && age <= 35) ageRanges.push("26-35");
        else if (age >= 36) ageRanges.push("36+");
    }

    return ageRanges;
}

const getGenderRange = (gender) => {

    gender = gender && ["men", "women", "other"].includes(gender.toLowerCase())
        ? gender.toLowerCase()
        : "all";

    return ["all", gender];
    
}

// editor.js block format blog content to text format for AI check

const extractTextFromEditorJS = (blocks = []) => {
    return blocks
    .map((block) => {
      switch (block.type) {
        case "paragraph":
          return block.data.text;
        case "header":
          return block.data.text;
        case "list":
          return block.data.items.join("\n");
        case "quote":
          return `${block.data.text} — ${block.data.caption || ""}`;
        case "code":
          return block.data.code;
        case "embed":
          return `${block.data.caption || block.data.source || ""}`;
        default:
          return "";
      }
    })
    .join("\n");
}

// ping route to keep server aline in render through uptimerobot
server.get("/ping-db", async (req, res) => {
  try {
    // Send a ping command to MongoDB
    await mongoose.connection.db.admin().command({ ping: 1 });
    return res.status(200).json({ mongo: "ok", server: "ok" });
  } catch (err) {
    console.error("MongoDB ping failed:", err);
    return res.status(500).json({ mongo: "down", error: err.message });
  }
});
// upload image url route
server.get('/get-upload-url', (req, res) => {
    generateUploadURL().then(url => res.status(200).json({ uploadURL: url }))
    .catch(err => {
        console.log(err.message);
        return res.status(500).json({ error: err.message })
    })
})

server.post("/signup", async (req, res) => {

    let { fullname, email, password, age: birthdate, gender, interests } = req.body;

    try {
        // validating the data from frontend
        if(fullname.length < 3){
                return res.status(403).json({ "error": "Fullname must be at least 3 letters long" })
        }
        if(!email.length){
                return res.status(403).json({ "error": "Enter Email" })
        }
        if(!emailRegex.test(email)){
                return res.status(403).json({ "error": "Email is invalid" })
        }
        if(!passwordRegex.test(password)){
                return res.status(403).json({ "error": "Password should be 6 to 20 characters long with a numeric, 1 lowercase and 1 uppercase letters" })
        }

        bcrypt.hash(password, 10, async (err, hashed_password) => {

            // check email from banned list

            const isBanned = await Ban.findOne({ email });

            if(isBanned){ return res.status(403).json({ error: "this email is banned by the admin." }) }
            
            let username = await generateUsername(email);

            let user = new User({
                personal_info: { fullname, email, password: hashed_password, username, birthdate, interests, gender }
            })

            const u = await user.save()

            logActivity(u, "user", "joined", username, null, u._id);

            return res.status(200).json(formatDatatoSend(u));

        }) 

    } catch(err) {
        if(err.code == 11000) {
            return res.status(500).json({ "error": "Email already exists" })
        }

        return res.status(500).json({ "error": err.message })
    }

})

server.post("/signin", async (req, res) => {

    let { email, password } = req.body;

    try {

        const isBanned = await Ban.findOne({ email });

        if(isBanned){ return res.status(403).json({ error: "this email is banned by the admin." }) }

        const user = await User.findOne({ "personal_info.email": email })

        if(!user){
            return res.status(403).json({ "error": "Email not found" });
        }
        
        if(!user.google_auth){

            bcrypt.compare(password, user.personal_info.password, (err, result) => {

                if(err) {
                    return res.status(403).json({ "error": "Error occured while login please try again" });
                }
    
                if(!result){
                    return res.status(403).json({ "error": "Incorrect password" })
                } else{
                    return res.status(200).json(formatDatatoSend(user))
                }
    
            })

        } else {
            return res.status(403).json({ "error": "Account was created using google. Try logging in with google." })
        }

    } catch(err){
        console.log(err.message);
        return res.status(500).json({ "error": err.message })
    }

})

server.post("/change-password", verifyJWT, async (req, res) => {

    try {

        let { currentPassword, newPassword } = req.body; 

        if(!passwordRegex.test(currentPassword) || !passwordRegex.test(newPassword)){
            return res.status(403).json({ error: "Password should be 6 to 20 characters long with a numeric, 1 lowercase and 1 uppercase letters" })
        }

        const user = await User.findOne({ _id: req.user })

        if(user.google_auth){
            return res.status(403).json({ error: "You can't change account's password because you logged in through google" })
        }

        bcrypt.compare(currentPassword, user.personal_info.password, (err, result) => {
            if(err) {
                return res.status(500).json({ error: "Some error occured while changing the password, please try again later" })
            }

            if(!result){
                return res.status(403).json({ error: "Incorrect current password" })
            }

            bcrypt.hash(newPassword, 10, async (err, hashed_password) => {

                await User.findOneAndUpdate({ _id: req.user }, { "personal_info.password": hashed_password })
        
                return res.status(200).json({ status: 'password changed' })

            })
        })

    } catch(err){
        console.log(err);
        res.status(500).json({ error : "User not found" })
    }

}) 

server.post('/latest-blogs', async (req, res) => {
    try {
        let { page, birthdate, gender, interests } = req.body;

        const ageRanges = getAgeRange(birthdate);
        const genderRanges = getGenderRange(gender);

        const baseQuery = {
            draft: false,
            targetGender: { $in: genderRanges, $exists: true },
            ageRating: { $in: ageRanges, $exists: true }
        };

        const maxLimit = 5;
        const skipCount = (page - 1) * maxLimit;

        // 1️⃣ Blogs that match interests
        const interestBlogs = await Blog.find({
            ...baseQuery,
            interests: { $in: interests }
        })
        .populate("author", "personal_info.profile_img personal_info.username personal_info.fullname -_id")
        .populate("category", "name")
        .sort({ publishedAt: -1 })
        .select("blog_id title des banner activity publishedAt -_id ageRating targetGender")
        .skip(skipCount)
        .limit(maxLimit);

        // 2️⃣ Blogs that match age+gender but NOT interests
        const otherBlogs = await Blog.find({
            ...baseQuery,
            interests: { $nin: interests }
        })
        .populate("author", "personal_info.profile_img personal_info.username personal_info.fullname -_id")
        .populate("category", "name")
        .sort({ publishedAt: -1 })
        .select("blog_id title des banner activity publishedAt -_id ageRating targetGender")
        .skip(skipCount)
        .limit(maxLimit);

        // 3️⃣ Combine them — interests first
        const blogs = [...interestBlogs, ...otherBlogs];

        return res.status(200).json({ blogs });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: err.message });
    }
});

server.post("/all-latest-blogs-count", async (req, res) => {
    try {
        const { birthdate, gender } = req.body;

        const ageRanges = getAgeRange(birthdate);
        const genderRanges = getGenderRange(gender);

        const baseQuery = {
        draft: false,
        targetGender: { $in: genderRanges, $exists: true },
        ageRating: { $in: ageRanges, $exists: true }
        };

        const totalDocs = await Blog.countDocuments(baseQuery);
        return res.status(200).json({ totalDocs });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: err.message });
    }
});

server.get("/trending-blogs", (req, res) => {

    Blog.find({ draft: false })
    .populate("author", "personal_info.profile_img personal_info.username personal_info.fullname -_id")
    .sort({ "activity.total_read": -1, "activity.total_likes": -1, "publishedAt": -1 })
    .select("blog_id title publishedAt -_id")
    .limit(5)
    .then(blogs => {
        return res.status(200).json({ blogs })
    })
    .catch(err => {
        return res.status(500).json({ error: err.message })
    })

})

server.post("/search-blogs", (req, res) => {

    let { category, query, author, page, limit, eliminate_blog } = req.body;

    let findQuery;
    
    if(category){
        findQuery = { category, draft: false, blog_id: { $ne: eliminate_blog } };
    } else if(query){
        findQuery = { draft: false, title: new RegExp(query, 'i') } 
    } else if(author) {
        findQuery = { author, draft: false }
    }
    
    let maxLimit = limit ? limit : 2;
    
    Blog.find(findQuery)
    .populate("author", "personal_info.profile_img personal_info.username personal_info.fullname -_id")
    .populate("category", "name")
    .sort({ "publishedAt": -1 })
    .select("blog_id title des banner activity publishedAt -_id")
    .skip((page - 1) * maxLimit)
    .limit(maxLimit)
    .then(blogs => {
        return res.status(200).json({ blogs })
    })
    .catch(err => {
        console.log(err)
        return res.status(500).json({ error: err.message })
    })

})

server.post("/search-blogs-count", (req, res) => {

    let { category, author, query } = req.body;

    let findQuery;

    if(category){
        findQuery = { category, draft: false };
    } else if(query){
        findQuery = { draft: false, title: new RegExp(query, 'i') } 
    } else if(author) {
        findQuery = { author, draft: false }
    }

    Blog.countDocuments(findQuery)
    .then(count => {
        return res.status(200).json({ totalDocs: count })
    })
    .catch(err => {
        console.log(err.message);
        return res.status(500).json({ error: err.message })
    })

})

server.post("/search-users", (req, res) => {

    let { query } = req.body;

    User.find({ "personal_info.username": new RegExp(query, 'i') })
    .limit(50)
    .select("personal_info.fullname personal_info.username personal_info.profile_img -_id")
    .then(users => {
        return res.status(200).json({ users })
    })
    .catch(err => {
        return res.status(500).json({ error: err.message })
    })

})

server.post("/get-profile", (req, res) => {

    let { username } = req.body;

    User.findOne({ "personal_info.username": username })
    .select("-personal_info.password -google_auth -updatedAt -blogs")
    .then(user => {
        return res.status(200).json(user)
    })
    .catch(err => {
        console.log(err);
        return res.status(500).json({ error: err.message })
    })

})

server.post("/update-profile-img", verifyJWT, async (req, res) => {

    let { url } = req.body;

    try {
        await User.findOneAndUpdate({ _id: req.user }, { "personal_info.profile_img": url })

        return res.status(200).json({ profile_img: url })
    
    }catch(err) {
        return res.status(500).json({ error: err.message })
    }

})

server.post("/update-profile", verifyJWT, async (req, res) => {

    let { username = "", bio = "", social_links = {} } = req.body;

    let bioLimit = 150;

    if(username.length < 3){
        return res.status(403).json({ error: "Username should be at least 3 letters long" });
    }

    if(bio.length > bioLimit){
        return res.status(403).json({ error: `Bio should not be more than ${bioLimit} characters` });
    }

    let socialLinksArr = Object.keys(social_links);

    try {

        for(let i = 0; i < socialLinksArr.length; i++){
            if(social_links[socialLinksArr[i]].length){
                let hostname = new URL(social_links[socialLinksArr[i]]).hostname; 

                if(!hostname.includes(`${socialLinksArr[i]}.com`) && socialLinksArr[i] != 'website'){
                    return res.status(403).json({ error: `${socialLinksArr[i]} link is invalid. You must enter a full link` })
                }

            }
        }

    } catch (err) {
        return res.status(500).json({ error: "You must provide full social links with http(s) included" })
    }

    let updateObj = {
        "personal_info.username": username,
        "personal_info.bio": bio,
        social_links
    }

    try {

        await User.findOneAndUpdate({ _id: req.user }, updateObj, {
            runValidators: true
        })

        return res.status(200).json({ username })

    } catch(err){
        if(err.code == 11000){
            return res.status(409).json({ error: "username is already taken" })
        }
        return res.status(500).json({ error: err.message })
    }

})

// ai check before publishing the blog
server.post("/check-blog-content-before-publishing", verifyJWT, async (req, res) => {

    try {

        const { title, des, content } = req.body;

        if(!title || !des || !content){ return res.status(400).json({ error: "Missing data" }) }
        
        const blog = extractTextFromEditorJS(content);

        if (!title.trim() || !blog.trim() || !des.trim()) {
            return res.json({ safe: true, reason: "Empty content" });
        }

        const prompt = `
            ${geminiPrompt}

            Title: """${title}"""
            Description: """${des}"""
            CONTENT: """${blog}"""
        `;

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-lite",
            contents: prompt
        });

        // Gemini responses come as rich objects; get plain text:

        const raw = response.text; // the model output string
        const result = JSON.parse(raw.substring(7, raw.length-3));

        res.status(200).json({ result }); 

    } catch(err){
        console.log(err);
        return res.status(500).json({ error: err.message })
    }

})

server.post('/create-blog', verifyJWT, async (req, res) => {

    let authorId = req.user;

    let { title, des, banner, category, content, draft, id, targetGender, ageRating } = req.body;

    console.log(req.body)

    if(!title.length){
        return res.status(400).json({ error: "You must provide a title" });
    }

    if(!draft){
        if(!des.length || des.length > 200){
            return res.status(400).json({ error: "You must provide blog description under 200 characters" });
        }

        if(!category.length){
            return res.status(400).json({ error: "You must give blog category before publishing" })
        }
    
        if(!banner.length){
            return res.status(400).json({ error: "You must provide blog banner to publish it" });
        }
    
        if(!content.blocks.length){
            return res.status(400).json({ error: "There must be some blog content to publish it" });
        }

        if(!["all", "men", "women", "other"].includes(targetGender.toLowerCase())){
            return res.status(400).json({ error: "Invalid value of gender" })
        }

        if(!["all", "13-17", "18-25", "26-35", "35+"].includes(ageRating.toLowerCase())){
            return res.status(400).json({ error: "Invalid age rating value" })
        }
    
        // if(!tags.length || tags.length > 10){
        //     return res.status(400).json({ error: "Provide tags in order to publish the blog, Maximum 10" });
        // }
    }

    // check category 

    let categoryDoc = null;

    if(category && category.length) {
        categoryDoc = await Category.findOne({ name: category.toLowerCase() });

        if(!categoryDoc){
            return res.status(400).json({ error: "Provided category does not exists" })
        }
    }

    // tags = tags.map(tag => tag.toLowerCase());

    let blog_id = id || title.replace(/[^a-zA-Z0-9]/g, ' ').replace(/\s+/g, "-").trim() + nanoid();

    try {

        if(id){ // updating the blog

            const old_doc = await Blog.findOne({ blog_id }).select("category draft"); // old doc

            if(!old_doc){
                return res.status(200).json({ id: blog_id }); // allowing 404 docs to process the request in case admin's and user's activity overlaps
            }

            let dataToUpdate = { title, des, banner, content, draft: draft ? draft : false, ageRating, targetGender };

            if(categoryDoc){
                dataToUpdate.category = categoryDoc._id
            }

            const b = await Blog.findOneAndUpdate({ blog_id }, dataToUpdate, { new: true })

            // draft -> publish > Add 1 to user and category count

            if(old_doc.draft && !b.draft){ // draft = true -> draft = false
                
                await Category.findOneAndUpdate({ _id: b.category }, { $inc: { blog_count: 1 } }) // update blog count of updated category
                
                await User.findOneAndUpdate({ _id: b.author }, { $inc : { "account_info.total_posts" : 1 }, $push : { "blogs": b._id } }) // update the author total post by 1

            }

            // publish -> draft > Remove 1 from user and category count

            if(!old_doc.draft && b.draft){ // draft = false -> draft = true

                await Category.findOneAndUpdate({ _id: old_doc.category }, { $inc: { blog_count: -1 } }) // update blog count of updated category
                
                await User.findOneAndUpdate({ _id: b.author }, { $inc : { "account_info.total_posts" : -1 }, $pull : { "blogs": b._id } }) // update the author total post by 1

            }

            // publish -> publish > Compare category and manage 1 count there

            if(!old_doc.draft && !b.draft){ // draft = false -> draft = false
                if(old_doc.category !== b.category){
                    await Category.findOneAndUpdate({ _id: old_doc.category }, { $inc: { blog_count: -1 } }) // update blog count of updated category
                    await Category.findOneAndUpdate({ _id: b.category }, { $inc: { blog_count: 1 } }) // update blog count of updated category
                }
            }

            if(!draft){ // save this activity only if the blog is not drafted
                logActivity(authorId, "blog", b.published ? "updated" : "published", blog_id, b.title, b._id)
            } else {
                await Activity.deleteMany({ ref: b._id });
            }

            if(!b.published && !draft){
                await Blog.findOneAndUpdate({ blog_id }, { published: true });
            }

            return res.status(200).json({ id: blog_id });

        } else { // creating a new blog

            let dataToSave = {
                title, des, banner, content, author: authorId, blog_id, draft: !!draft, published: !!draft ? false : true, ageRating, targetGender
            };

            if(categoryDoc){
                dataToSave.category = categoryDoc._id;
            }

            let blog = new Blog(dataToSave)
        
            const b = await blog.save();
        
            let incrementVal = draft ? 0 : 1;

            if(!draft){ // save this activity only if the blog is not drafted

                // update category count

                await Category.findOneAndUpdate({ name: category.toLowerCase() }, { $inc: { blog_count: 1 } })

                logActivity(authorId, "blog", "published", blog_id, b.title, b._id)
            }

            await User.findOneAndUpdate({ _id: authorId }, { $inc : { "account_info.total_posts" : incrementVal }, $push : { "blogs": b._id } })

            return res.status(200).json({ id: b.blog_id })

        }

    } catch(err){
        console.log(err);
        return res.status(500).json({ error: err.message })
    }

})

server.get("/get-blog", async (req, res) => {
    
    let { blog_id } = req.query; 

    try {
        const doc = await Blog.exists({ blog_id })

        if(!doc){ return res.status(404).json({ error: "Blog not found" }) }

        const blog = await Blog.findOneAndUpdate({ blog_id }, { $inc : { "activity.total_reads": 1 } }, { new: true })
        .populate("author", "personal_info.fullname personal_info.username personal_info.profile_img")
        .populate("category", "name")
        .select("title des content banner activity draft publishedAt blog_id ");

        await User.findOneAndUpdate({ "personal_info.username": blog.author.personal_info.username }, { 
                $inc : { "account_info.total_reads": 1 }
            })

        return res.status(200).json({ blog });
        
    } catch(err){
        console.log(err);
        return res.status(500).json({ error: err.message })
    }

})

server.post("/get-blog", verifyJWT, async (req, res) => {

    const user_id = req.user;
    
    let { blog_id } = req.body;

    let incrementVal = 0;

    try {
        const doc = await Blog.exists({ blog_id, author: user_id })

        if(!doc){ return res.status(404).json({ error: "Blog not found" }) }

        const blog = await Blog.findOneAndUpdate({ blog_id }, { $inc : { "activity.total_reads": incrementVal } }, { new: true })
        .populate("author", "personal_info.fullname personal_info.username personal_info.profile_img")
        .populate("category", "name")
        .select("title des content banner activity draft publishedAt blog_id ageRating targetGender");

        await User.findOneAndUpdate({ "personal_info.username": blog.author.personal_info.username }, { 
                $inc : { "account_info.total_reads": incrementVal }
            })

        return res.status(200).json({ blog });

    } catch(err){
        console.log(err);
        return res.status(500).json({ error: err.message })
    }

})

server.post("/like-blog", verifyJWT, async (req, res) => {

    let user_id = req.user;

    let { _id, islikedByUser } = req.body;

    let incrementVal = !islikedByUser ? 1 : -1;

    try {

        // find the doc

        const doc = await Blog.exists({ _id });

        if(!doc){ return res.status(200).json({ liked_by_user: !islikedByUser }) } // allowing 404 docs to process the request in case admin's and user's activity overlaps

        const blog = await Blog.findOneAndUpdate({ _id }, { $inc: { "activity.total_likes": incrementVal } })

        if(!islikedByUser){
            
            let like = new Notification({
                type: "like",
                blog: _id,
                notification_for: blog.author,
                user: user_id
            })

            await like.save();

            return res.status(200).json({ liked_by_user: true })

        } else{

            await Notification.findOneAndDelete({ user: user_id, blog: _id, type: "like" })
            
            return res.status(200).json({ liked_by_user: false })

        }

    } catch(err){
        console.log(err);
        return res.status(500).json({ err: err.message })
    }

})

server.post("/isliked-by-user", verifyJWT, (req, res) => {
    
    let user_id = req.user;

    let { _id } = req.body;

    Notification.exists({ user: user_id, type: "like", blog: _id })
    .then(result => {
        return res.status(200).json({ result }) 
    })
    .catch(err => {
        return res.status(500).json({ error: err.message })
    })

}) 

server.post("/add-comment", verifyJWT, async (req, res) => {

    let user_id = req.user;

    let { _id, comment, blog_author, replying_to, notification_id } = req.body;

    if(!comment.length) {
        return res.status(403).json({ error: 'Write something to leave a comment' });
    }

    try {
        // creating a comment doc
        let commentObj = {
            blog_id: _id, blog_author, comment, commented_by: user_id,
        }

        if(replying_to){

            // check for parent doc existence

            const c = await Comment.exists({ _id: replying_to });
            
            if(!c){ return res.status(404).json({ error: "comment not found" }) }

            commentObj.parent = replying_to;
            commentObj.isReply = true;
        }

        const commentFile = await new Comment(commentObj).save();

        let { commentedAt, children } = commentFile;

        const b = await Blog.findOneAndUpdate({ _id }, { $push: { "comments": commentFile._id }, $inc : { "activity.total_comments": 1, "activity.total_parent_comments": replying_to ? 0 : 1 },  })

        logActivity(user_id, "comment", commentFile.isReply ? "replied" : "commented", null, comment, commentFile._id, commentFile.isReply ? commentFile.parent : null, b._id);
            

        let notificationObj = {
            type: replying_to ? "reply" : "comment",
            blog: _id,
            notification_for: blog_author,
            user: user_id,
            comment: commentFile._id
        }

        if(replying_to){

            notificationObj.replied_on_comment = replying_to;

            const replyingToCommentDoc = await Comment.findOneAndUpdate({ _id: replying_to }, { $push: { children: commentFile._id } })
            
            notificationObj.notification_for = replyingToCommentDoc.commented_by

            if(notification_id){
                await Notification.findOneAndUpdate({ _id: notification_id }, { reply: commentFile._id })
            }

        }

        await new Notification(notificationObj).save();

        return res.status(200).json({
            comment, commentedAt, _id: commentFile._id, user_id, children
        })

    } catch(err){
        console.log(err);
        return res.status(500).json({ error: err.message })
    }


}) 

server.post("/get-blog-comments", (req, res) => {

    let { blog_id, skip } = req.body;

    let maxLimit = 5;

    Comment.find({ blog_id, isReply: false })
    .populate("commented_by", "personal_info.username personal_info.fullname personal_info.profile_img")
    .skip(skip)
    .limit(maxLimit)
    .sort({
        'commentedAt': -1
    })
    .then(comment => {
        return res.status(200).json(comment);
    })
    .catch(err => {
        console.log(err.message);
        return res.status(500).json({ error: err.message })
    })

})

server.post("/get-replies", (req, res) => {

    let { _id, skip } = req.body;

    let maxLimit = 5;

    Comment.findOne({ _id })
    .populate({
        path: "children",
        options: {
            limit: maxLimit,
            skip: skip,
            sort: { 'commentedAt': -1 }
        },
        populate: {
            path: 'commented_by',
            select: "personal_info.profile_img personal_info.fullname personal_info.username"
        },
        select: "-blog_id -updatedAt"
    })
    .select("children")
    .then(doc => {
        return res.status(200).json({ replies: doc.children })
    })
    .catch(err => {
        return res.status(500).json({ error: err.message })
    })

})

const deleteComments = async (
  _id,
  reason = null,
  super_admin = false,
  toWarn = false,
  report_id = null,
  img = null
) => {
    try {
        const comment = await Comment.findOneAndDelete({ _id });

        if (!comment) return; // nothing to delete

        if (comment.parent) {
            await Comment.findOneAndUpdate(
                { _id: comment.parent },
                { $pull: { children: _id } }
            );
        }

        if (super_admin && reason && typeof reason === "string" && reason.trim().length) {
            const alert = {
                type: comment.isReply ? "reply" : "comment",
                content: comment.comment,
                reason,
            };

            if(img){ alert.img = img }
            const userUpdate = {
                $push: {
                    alerts: alert
                },
            };

            if (toWarn) userUpdate.warned = true;

            await User.findOneAndUpdate({ _id: comment.commented_by }, userUpdate);

            if (report_id) {
                await Report.findOneAndDelete({ _id: report_id });
            }

        }

        await Promise.all([
            Activity.deleteMany({ ref: _id }),
            Report.deleteMany({ ref: _id }),
            Notification.deleteMany({ comment: _id }),
            Notification.updateMany({ reply: _id }, { $unset: { reply: 1 } }),
        ]);

        const incUpdate = { "activity.total_comments": -1 };
        if (!comment.parent) {
            incUpdate["activity.total_parent_comments"] = -1;
        }

        await Blog.findOneAndUpdate(
            { _id: comment.blog_id },
            {
                $pull: { comments: _id },
                $inc: incUpdate,
            }
        );

        if (comment.children.length) {
            await Promise.all(
                comment.children.map((replyId) =>
                    deleteComments(replyId)
                )
            );
        }
    } catch (err) {
        console.error(err);
    }
};

server.post("/delete-comment", verifyJWT, async (req, res) => {

    let user_id = req.user;
    let super_admin = req.super_admin;

    let { _id, reason, toWarn, report_id, img } = req.body;

    try {

        // check comment exists or not

        const comment = await Comment.findOne({ _id });

        if(!comment){ return res.status(200).json({ status: 'done' }) }

        if( user_id == comment.commented_by || user_id == comment.blog_author || super_admin ){

            await deleteComments(_id, reason, super_admin, toWarn, report_id, img)

            return res.status(200).json({ status: 'done' });

        } else{
            return res.status(403).json({ error: "You can not delete this comment" })
        }

    } catch(err){
        console.log(err);
        return res.status(500).json({ error: err.message })
    }

})

server.get("/new-notification", verifyJWT, async (req, res) => { // return alerts along with notifications

    let user_id = req.user;

    try {

        const new_notification_available = !!(await Notification.exists({ notification_for: user_id, seen: false, user: { $ne: user_id } }));

        // alerts
        const user = await User.findOne({ _id: user_id }).select("alerts");
        
        return res.status(200).json({ new_notification_available, alerts: user.alerts })

    } catch(err){
        console.log(err.message);
        return res.status(500).json({ error: err.message })
    }

})

server.post("/notifications", verifyJWT, (req, res) => {
    let user_id = req.user;

    let { page, filter, deletedDocCount } = req.body;

    let maxLimit = 10;

    let findQuery = { notification_for: user_id, user: { $ne: user_id } };

    let skipDocs = ( page - 1 ) * maxLimit;

    if(filter != 'all'){
        findQuery.type = filter;
    }

    if(deletedDocCount){
        skipDocs -= deletedDocCount;
    }

    Notification.find(findQuery)
    .skip(skipDocs)
    .limit(maxLimit)
    .populate("blog", "title blog_id")
    .populate("user", "personal_info.fullname personal_info.username personal_info.profile_img")
    .populate("comment", "comment")
    .populate("replied_on_comment", "comment")
    .populate("reply", "comment")
    .populate("community", "name")
    .sort({ createdAt: -1 })
    .select("createdAt type seen reply")
    .then(notifications => {

        Notification.updateMany(findQuery, { seen: true })
        .skip(skipDocs)
        .limit(maxLimit)
        .then(() => console.log('notification seen'));

        return res.status(200).json({ notifications });

    })
    .catch(err => {
        console.log(err.message);
        return res.status(500).json({ error: err.message });
    })

})

server.post("/all-notifications-count", verifyJWT, (req, res) => {

    let user_id = req.user;

    let { filter } = req.body;

    let findQuery = { notification_for: user_id, user: { $ne: user_id } }

    if(filter != 'all'){
        findQuery.type = filter;
    }

    Notification.countDocuments(findQuery)
    .then(count => {
        return res.status(200).json({ totalDocs: count })
    })
    .catch(err => {
        return res.status(500).json({ error: err.message })
    })

})

server.post("/user-written-blogs", verifyJWT, (req, res) => {

    let user_id = req.user;

    let { page, draft, query, deletedDocCount } = req.body;

    let maxLimit = 5;
    let skipDocs = (page - 1) * maxLimit;

    if(deletedDocCount){
        skipDocs -= deletedDocCount;
    }

    Blog.find({ author: user_id, draft, title: new RegExp(query, 'i') })
    .skip(skipDocs)
    .limit(maxLimit)
    .sort({ publishedAt: -1 })
    .select(" title banner publishedAt blog_id activity des draft -_id ")
    .then(blogs => {
        return res.status(200).json({ blogs })
    })
    .catch(err => {
        return res.status(500).json({ error: err.message });
    })

})

server.post("/user-written-blogs-count", verifyJWT, (req, res) => {

    let user_id = req.user;

    let { draft, query } = req.body;

    Blog.countDocuments({ author: user_id, draft, title: new RegExp(query, 'i') })
    .then(count => {
        return res.status(200).json({ totalDocs: count })
    })
    .catch(err => {
        console.log(err.message);
        return res.status(500).json({ error: err.message });
    })

})

server.post("/delete-blog", verifyJWT, async (req, res) => {
    let user_id = req.user;
    let super_admin = req.super_admin;
    let { blog_id, reason, toWarn, report_id, img } = req.body;

    try {
        // Check if blog exists
        const blog = await Blog.findOne({ blog_id });
        if (!blog) {
            return res.status(200).json({ status: "done" }); // allowing 404 docs to process the request in case admin's and user's activity overlaps
        }

        // Authorization check
        if (blog.author.toString() !== user_id.toString()) {

            if (!super_admin) {
                return res.status(403).json({ error: "Method not allowed" });
            }
            if (typeof reason !== "string" || !reason.trim().length) {
                return res
                .status(403)
                .json({ error: "A valid reason must be provided to delete this content" });
            }
        }

        // Delete the blog
        const deletedBlog = await Blog.findOneAndDelete({ blog_id });
        if (!deletedBlog) {
            return res.status(404).json({ error: "blog not found" });
        }

        // Log and clean up
        // logActivity(user_id, "blog", "deleted", null, deletedBlog.title, null);

        await Promise.all([
            Activity.deleteMany({ ref: deletedBlog._id }),
            Notification.deleteMany({ blog: deletedBlog._id }),
        ]);

        // delete comments related to blogs along with there activity logs
        const commentsToDelete = await Comment.find({ blog_id: deletedBlog._id });

        const commentIds = commentsToDelete.map(c => c._id);

        await Comment.deleteMany({ blog_id: deletedBlog._id });

        await Activity.deleteMany({ ref: { $in: commentIds } });

        let userUpdates = {
            $pull: { blogs: deletedBlog._id },
            $inc: { "account_info.total_posts": -1 },
        };

        if (super_admin && deletedBlog.author.toString() !== user_id.toString()) {
            const alert = { type: "blog", content: deletedBlog.title, reason };

            if(img){ alert.img = img };
            
            userUpdates.$push = {
                alerts: alert,
            };
            if(toWarn){
                userUpdates.warned = toWarn
            }
            if(report_id){
                // delete the report
                await Report.findOneAndDelete({ _id: report_id });
            }
        }

        if(!deletedBlog.draft){
            
            await User.findOneAndUpdate({ _id: deletedBlog.author }, userUpdates);

            await Category.findOneAndUpdate({ _id: deletedBlog.category }, { $inc: { blog_count: -1 } })
            
        }

        return res.status(200).json({ status: "done" });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Got some problem" });
    }
});

server.get("/clear-alerts", verifyJWT, async (req, res) => {
    const user_id = req.user;

    try {

        await User.findOneAndUpdate({ _id: user_id }, { alerts: [] })

        return res.status(200).json({ status: 'done' })

    } catch(err){
        console.log(err);
        return res.status(500).json({ error: err.message })
    }
})

// communities

server.post('/create-community', verifyJWT, async (req, res) => {

    const user = req.user;

    try {

        const { name, des, image, banner, interests } = req.body;

        const desLimit = 250;
        // validate data

        if(!name || name.length < 3){ return res.status(400).json({ error: "Proide a community name that should be at least 3 characters long." }) }

        if(!des || des.length > desLimit){ return res.status(400).json({ error: "Provide a short description for the community under " + desLimit + " characters." }) }

        if(!image){ return res.status(400).json({ error: "Provide community image to create the community" }) }

        if(!interests || !interests.length || !Array.isArray(interests)){ return res.status(400).json({ error: "Provide at least 1 interest for this community to continue" }) }

        // create the community

        // generate community id

        const id = nanoid();

        const communityObj = { community_id: id, name, des, image, banner, interests, admin: user, members: [ user ] };

        const community = new Community(communityObj);

        const communityDoc = await community.save(); 

        // save this community in users doc

        await User.findOneAndUpdate({ _id: user }, { $push: { communities: communityDoc._id } })

        return res.status(200).json({ id })

    } catch(err){
        console.log(err);
        return res.status(500).json({ error: err.message })
    }

})

server.post("/search-communities", async (req, res) => {

    let { category, query, page, limit } = req.body;

    let findQuery = {};
    
    if(category){
        findQuery = { interests: category };
    } else if(query){
        findQuery = { name: new RegExp(query, 'i') } 
    } 

    let maxLimit = limit ? limit : 2;
    
    try {

        const communities = await Community.aggregate([
                            { $match: findQuery },
                            {
                                $addFields: {
                                membersCount: { $size: "$members" }
                                }
                            },
                            {
                                $sort: { membersCount: -1 }
                            },
                            {
                                $project: {
                                    _id: 1,
                                    name: 1,
                                    image: 1,
                                    membersCount: 1,
                                    interests: 1,
                                    community_id: 1
                                }
                            },
                            { $skip: (page - 1) * maxLimit },
                            { $limit: maxLimit }
                        ]);

        return res.status(200).json({ communities });

    } catch(err){
        console.log(err);
        return res.status(500).json({ error: err.message })
    }

})

server.post("/search-communities-count", (req, res) => {

    let { category, query } = req.body;

    let findQuery = {};

    if(category){
        findQuery = { interests: category, draft: false };
    } else if(query){
        findQuery = { name: new RegExp(query, 'i') } 
    }

    Community.countDocuments(findQuery)
    .then(count => {
        return res.status(200).json({ totalDocs: count })
    })
    .catch(err => {
        console.log(err.message);
        return res.status(500).json({ error: err.message })
    })

})

server.get("/community/:id", verifyJWT, async (req, res) => {

    const user = req.user;

    const { id } = req.params;
    
    try {
        
        const community = await Community.aggregate([
                            { $match: { community_id: id } },
                            {
                                $lookup: {
                                    from: "users",
                                    localField: "admin",
                                    foreignField: "_id",
                                    as: "admin"
                                }
                            },
                            {
                                $unwind: "$admin"
                            },
                            {
                                $addFields: {
                                    membersCount: { $size: "$members" }
                                }
                            },
                            {
                                $project: {
                                    _id: 1,
                                    name: 1,
                                    image: 1,
                                    membersCount: 1,
                                    interests: 1,
                                    banner: 1,
                                    des: 1,
                                    community_id: 1,
                                    'admin.personal_info.username': 1,
                                    'admin.personal_info.profile_img': 1,
                                    createdAt: 1,
                                }
                            }
                        ]);

        if(!community.length){
            return res.status(404).json({ error: "not found" })
        }

        let user_joined_status = await Community.findOne({ community_id: id, members: user });

        return res.status(200).json({ community: community[0], joinStatus: !!user_joined_status })

    } catch(err){
        console.log(err.message);
        return res.status(500).json({ error: err.message })
    }

})

server.post("/join-leave-community", verifyJWT, async (req, res) => {

    const user = req.user;

    let { community_id, action, member } = req.body;

    try {

        action = action.toLowerCase();

        if(!["leave", "join", "kick"].includes(action)){
            return res.status(400).json({ error: "Invalid data provided" })
        }

        let updateObj = {};
        let findQuery = { community_id, admin: { '$ne': user } };

        if(action == "join"){ updateObj = { $push: { members: user } } }
        else if(action == "leave"){ updateObj = { $pull: { members: user } } }

        if(action == "kick"){
            
            if(!member){ return res.status(400).json({ error: "Missing data." }) }

            updateObj = { $pull: { members: member } }
            findQuery = { community_id, admin: { '$eq': user } }

        }
        
        const doc = await Community.findOneAndUpdate(findQuery, updateObj);

        if(action == "kick"){

            // save notification
            let notificationObj = { type: "kick", notification_for: member, user, community: doc._id };

            await new Notification(notificationObj).save();

            // delete user's posts
            await Post.deleteMany({ post_by: member });

        }

        // update user's communities info

        let updateUserParam = {};
        let updateFilerQuery = { _id: user };

        if(action == "join"){
            updateUserParam = { $push: { communities: doc._id } }
        }

        if(action == "leave"){
            updateUserParam = { $pull: { communities: doc._id } }
        }

        if(action == "kick"){
            updateUserParam = { $pull: { communities: doc._id } }
            updateFilerQuery = { _id: member }
        }

        await User.findOneAndUpdate(updateFilerQuery, updateUserParam);

        return res.status(200).json({ doc })
        
    } catch(err){
        console.log(err);
        return res.status(500).json({ error: err.message })
    }

})

server.get("/community-members", async (req, res) => {

    const { id } = req.query;

    try {

        const doc = await Community.findOne({ community_id: id }).populate("members", "personal_info.username personal_info.profile_img _id").select("members");

        if(!doc){ return res.status(404).json({ error: "community not found" }) }

        return res.status(200).json({ members: doc.members })

    } catch(err){
        console.log(err);
        return res.status(500).json({ error: err.message })
    }

})

server.get("/joined-communities", verifyJWT, async (req, res) => {

    const user = req.user;

    try {

        const doc = await User.findOne({ _id: user }).populate("communities", "name image community_id").select("communities");
        
        let communities = doc.communities;
        let filteredData = communities.filter((item) => item)

        return res.status(200).json({ communities: filteredData });
        
    } catch(err){
        console.log(err);
        return res.status(500).json({ error: err.message })
    }

})

server.post("/create-post", verifyJWT, async (req, res) => {

    const user = req.user;

    try {

        const { community_id, text, image } = req.body;

        // validate data

        if(!text.length && !image.length){
            return res.status(400).json({ error: "Missing data" })
        }

        // check the user is a member of this community or not.

        const communityDoc = await Community.findOne({ community_id, members: user });

        if(!communityDoc){
            return res.status(404).json({ error: "Community not found with you as its member." })
        }

        // save the post

        const postObj = { text, image, community: communityDoc._id, post_by: user, community_admin: communityDoc.admin };

        const doc = await new Post(postObj).save();

        // sort communities

        const userDoc = await User.findOne({ _id: user }).select("communities");
        
        const filteredList = userDoc.communities.filter(item => !item.equals(communityDoc._id));

        const newList = [communityDoc._id, ...filteredList];

        await User.findOneAndUpdate({ _id: user }, { communities: [...newList] });

        return res.status(200).json({ id: doc._id })

    } catch(err){
        console.log(err);
        return res.status(500).json({ error: err.message })
    }

})

server.post("/community-posts", async(req, res) => {

    try {

        const { page, deletedDocCount, community_id } = req.body;
        let maxLimit = 20;

        let skipDocs = ( page - 1 ) * maxLimit;

        if (deletedDocCount) {
  skipDocs = Math.max(0, skipDocs - deletedDocCount);
}

        // get community doc id;

        const communityDoc = await Community.findOne({ community_id });

        if(!communityDoc){
            return res.status(404).json({ error: "Community not found" })
        }

        const posts = await Post.find({ community: communityDoc._id })
        .skip(skipDocs)
        .limit(maxLimit)
        .populate("post_by", "personal_info.username personal_info.profile_img")
        .sort({ createdAt: -1 })
        .select("createdAt text image");

        return res.status(200).json({ posts });

    } catch(err){
        console.log(err);
        return res.status(500).json({ error: err.message })
    }

})

server.post("/all-posts-count", async (req, res) => {

    try {

        const { community_id } = req.body;
        // get community doc id;

        const communityDoc = await Community.findOne({ community_id });

        if(!communityDoc){
            return res.status(404).json({ error: "Community not found" })
        }

        const count = await Post.countDocuments({ community: communityDoc._id })
        
        return res.status(200).json({ totalDocs: count })

    } catch(err){
        console.log(err);
        return res.status(500).json({ error: err.message })
    }

})

server.post("/delete-post", verifyJWT, async (req, res) => {

    const user = req.user;

    try {

        const { id } = req.body;
        
        // find the doc and delete it

        await Post.findOneAndDelete({ _id: id, $or: [{ community_admin: user }, { post_by: user }] })

        return res.status(200).json({ status: 'done' })


    }  catch(err){
        console.log(err);
        return res.status(500).json({ error: err.message })
    }


})

server.post("/delete-community", verifyJWT, async (req, res) => {

    const user = req.user;
    const super_admin = req.super_admin

    try {

        const { id } = req.body;

        // find the community

        const communityDoc = await Community.findOne({ _id: id });

        if(!communityDoc){
            return res.status(200).json({ status: 'done' })
        }

        if(communityDoc.admin != user && !super_admin){
            return res.status(400).json({ error: 'you are not allowed to perform this action' })
        }

        // delete the community

        await Community.findOneAndDelete({ _id: id });

        // delete the posts related to this community

        Post.deleteMany({ community: id })
        .then(() => console.log("Posts deleted for community:", id)) // silently deletes the posts.

        return res.status(200).json({ status: "done" })


    } catch(err){
        console.log(err);
        return res.status(500).json({ error: err.message })
    }

})

// super admin routes

server.post("/super-admin/activities", verifyJWT, (req, res) => {

    let super_admin = req.super_admin;

    if(!super_admin){ return res.status(403).json({ error: "Not Allowed" }) }

    let { page, filter, deletedDocCount } = req.body;

    let maxLimit = 100;

    let findQuery = { };

    let skipDocs = ( page - 1 ) * maxLimit;

    if(filter != 'all'){
        findQuery.type = filter[filter.length-1]=='s' ? filter.substring(0, filter.length-1) : filter; // removing 's' from the filter got from the frontend
    }

    if(deletedDocCount){
        skipDocs -= deletedDocCount;
    }

    Activity.find(findQuery)
    .skip(skipDocs)
    .limit(maxLimit)
    .populate("user", "personal_info.fullname personal_info.username personal_info.profile_img")
    .sort({ createdAt: -1 })
    .select(" -_id -__v -updatedAt")
    .then(activities => {

        return res.status(200).json({ activities });

    })
    .catch(err => {
        console.log(err.message);
        return res.status(500).json({ error: err.message });
    })

})

server.post("/all-activities-count", verifyJWT, async (req, res) => {

    let super_admin = req.super_admin;

    try {
        
        if(!super_admin){ return res.status(403).json({ error: "Not Allowed" }) }

        let { filter } = req.body;

        let findQuery = { }

        if(filter != 'all'){
            findQuery.type = filter[filter.length-1]=='s' ? filter.substring(0, filter.length-1) : filter; // removing 's' from the filter got from the frontend
        }

        const count = await Activity.countDocuments(findQuery)

        return res.status(200).json({ totalDocs: count })
        
    } catch(err) {
        console.log(err)
        return res.status(500).json({ error: err.message })
    }

    

})

// categories routes

server.get("/top-categories", async (req, res) => {
    try {

        let { limit } = req.query;

        limit = (limit !== undefined && limit > 0) ? limit : 10;

        let categories = await Category.find({}).select("name").sort({ blog_count: -1, _id: 1 }).limit(limit);

        // categories = categories.map((item) => item.name);

        return res.status(200).json({ categories });

    } catch(err){
        console.log(err);
        return res.status(500).json({ error: err.message })
    }
})

server.get("/categories", async (req, res) => {
    try {

        let categories = await Category.find({}).select("name").sort({ blog_count: -1, _id: 1 })

        categories = categories.map((item) => item.name)

        return res.status(200).json({ categories });

    } catch(err){
        console.log(err);
        return res.status(500).json({ error: err.message })
    }
})

server.post("/super-admin/add-categoy", verifyJWT, async (req, res) => {

    const super_admin = req.super_admin;
    
    try {

        if(!super_admin){
            return res.status(403).json({ error: "not allowed" })
        }

        let { category: str } = req.body;

        str = str.toLowerCase();

        // check category already exists or not

        const exists = await Category.exists({ name: str });

        if(exists){
            return res.status(400).json({ error: "category already exists" });
        }
        
        const cat = await new Category({ name: str }).save();

        return res.status(200).json({ category: cat });

    } catch(err){
        console.log(err);
        return res.status(500).json({ error: err.message })
    }

})

server.post("/super-admin/categories", verifyJWT, async (req, res) => {

    let super_admin = req.super_admin;

    try {

        if(!super_admin){
            return res.status(403).json({ error: "not allowed" })
        }

        let { page, deletedDocCount } = req.body;

        let maxLimit = 10;

        let skipDocs = ( page - 1 ) * maxLimit;

        if (deletedDocCount) {
            skipDocs = Math.max(0, skipDocs - deletedDocCount);
        }

        const categories = await Category.find({})
                            .sort({ blog_count: -1, _id: 1 })
                            .skip(skipDocs)
                            .limit(maxLimit)

        return res.status(200).json({ categories })

    } catch(err){
        console.log(err);
        return res.status(500).json({ error: err.message })
    }
})

server.post("/all-categories-count", verifyJWT, async (req, res) =>{

    let super_admin = req.super_admin;

    try {
        
        if(!super_admin){ return res.status(403).json({ error: "Not Allowed" }) }

        const count = await Category.countDocuments({})

        return res.status(200).json({ totalDocs: count })
        
    } catch(err) {
        console.log(err)
        return res.status(500).json({ error: err.message })
    }

})

server.post("/super-admin/update-category", verifyJWT, async (req, res) => {
    const super_admin = req.super_admin;

    try {

        if(!super_admin){
            return res.status(403).json({ error: "not allowed" })
        }

        const { _id, name } = req.body;

        // check name for existing doc
        const doc = await Category.exists({ name: name.toLowerCase() })

        if(doc){ return res.status(400).json({ error: "this name is already present" }) }

        await Category.findOneAndUpdate({ _id }, { name });

        return res.status(200).json({ status: "done" })

    } catch(err){
        console.log(err);
        return res.status(500).json({ error: err.message })
    }
})

const deleteBlogsRelatedToCategory = async (_id) => {

    try {

        // find all the blogs
        const reason = "The admin deleted this blog category, which resulted in the deletion of all blogs associated with it."
        const blogs = await Blog.find({ category: _id }).select("_id draft title author");

        const blogIds = blogs.map(b => b._id);

        // Get all comments across all blogs
        const commentsToDelete = await Comment.find({ blog_id: { $in: blogIds } }).select("_id");
        const commentIds = commentsToDelete.map(c => c._id);

        // loop through blogs to delete data

        if(blogs.length){
            await Promise.all([
                ...blogs.map(async (b) => {

                    // Delete the blog
                    await Blog.findOneAndDelete({ _id: b._id });

                    let userUpdates = {
                        $pull: { blogs: b._id },
                        $inc: { "account_info.total_posts": -1 },
                        $push: {
                            alerts: { type: "blog", content: b.title, reason },
                        }
                    };

                    if(!b.draft){
                        
                        await User.findOneAndUpdate({ _id: b.author }, userUpdates);
                        
                    }

                }),
                Comment.deleteMany({ blog_id: { $in: blogIds } }),
                Activity.deleteMany({ ref: { $in: [...commentIds, ...blogIds] } }),
                Notification.deleteMany({ blog: { $in: blogIds } })
            ])
        }

    } catch(err){
        console.log(err)
    }

}

server.post("/super-admin/delete-category", verifyJWT, async (req, res) => {

    const super_admin = req.super_admin;

    try {

        if(!super_admin){
            return res.status(403).json({ error: "not allowed" })
        }

        const { _id } = req.body;

        // check the category doc first
        const doc = await Category.findOne({ _id });

        if(!doc){
            return res.status(404).json({ error: "no category found with the provided id" })
        }

        // delete the comment

        await Category.findOneAndDelete({ _id });

        // delete the blogs related to categories along with notifications, activities and comments and add alert for blog authors and commenters.
        deleteBlogsRelatedToCategory(_id);

        return res.status(200).json({ status: "done" })


    } catch(err){
        console.log(err);
        return res.status(500).json({ error: err.message })
    }

})

// reports

server.post("/report-content", verifyJWT, async (req, res) => {

    const reporting_user = req.user;
    
    try {

        const { _id, username, reason, type } = req.body;
        
        if((!_id && !username) || !reason || !reason.trim().length || !["user", "blog", "comment"].includes(type)){
            return res.status(400).json({ error: "Invalid data" })
        }

        let reportData = {
            type, reported_by: reporting_user, reason: reason.trim().toLowerCase()
        }

        if(type == "user" && username){ // handle user reports

            const reported_user = await User.findOne({ "personal_info.username": username }).select("_id");

            if(!reported_user){
                return res.status(404).json({ error: "user not found" })
            }

            reportData = {
                ...reportData,
                user: reported_user._id,
                ref: reported_user._id
            }

        } else if(_id){ // handle blog and comment reports

            if(type == "blog"){ // reporting blog
                
                const reported_blog = await Blog.findOne({ _id }).select("blog_id title author")

                if(!reported_blog){
                    return res.status(404).json({ error: "blog not found" })
                }

                reportData = {
                    ...reportData,
                    user: reported_blog.author,
                    ref: _id,
                    link: reported_blog.blog_id,
                    content: reported_blog.title
                }

            } else {

                const reported_comment = await Comment.findOne({ _id }).select("commented_by comment isReply parent blog_id");

                if(!reported_comment){
                    return res.status(404).json({ error: "comment not found" })
                }

                reportData = {
                    ...reportData,
                    user: reported_comment.commented_by,
                    ref: _id,
                    content: reported_comment.comment,
                    blog_ref: reported_comment.blog_id
                }

                if(reported_comment.isReply){
                    reportData.parent_ref = reported_comment.parent
                }

            }

        } else {
            return res.status(400).json({ error: "Data provided is insufficient" })
        }

        // create and save the report

        await new Report(reportData).save();

        return res.status(200).json({ status: "done" })

    } catch(err){
        console.log(err);
        return res.status(500).json({ error: err.message })
    }

})

server.post("/super-admin/reports", verifyJWT, async (req, res) => {

    const super_admin = req.super_admin;

    try {

        if(!super_admin){
            return res.status(403).json({ error: "not allowed" })
        }
        
        let { page, filter, deletedDocCount } = req.body;

        let maxLimit = 10;

        let findQuery = { };

        let skipDocs = ( page - 1 ) * maxLimit;

        if(filter != 'all'){
            findQuery.type = filter[filter.length-1]=='s' ? filter.substring(0, filter.length-1) : filter; // removing 's' from the filter got from the frontend
        }

        if (deletedDocCount) {
            skipDocs = Math.max(0, skipDocs - deletedDocCount);
        }

        const reports = await Report.find(findQuery)
        .skip(skipDocs)
        .limit(maxLimit)
        .populate("user", "personal_info.fullname personal_info.username personal_info.profile_img _id warned")
        .populate("reported_by", "personal_info.fullname personal_info.username personal_info.profile_img _id")
        .sort({ createdAt: 1 })
        .select(" -__v -updatedAt")

        return res.status(200).json({ reports });

    } catch(err){
        console.log(err);
        return res.status(500).json({ error: err.message })
    }

})

server.post("/all-reports-count", verifyJWT, async (req, res) => {

    let super_admin = req.super_admin;

    try {
        
        if(!super_admin){ return res.status(403).json({ error: "Not Allowed" }) }

        let { filter } = req.body;

        let findQuery = { }

        if(filter != 'all'){
            findQuery.type = filter[filter.length-1]=='s' ? filter.substring(0, filter.length-1) : filter; // removing 's' from the filter got from the frontend
        }

        const count = await Report.countDocuments(findQuery)

        return res.status(200).json({ totalDocs: count })
        
    } catch(err) {
        console.log(err)
        return res.status(500).json({ error: err.message })
    }

    

})

server.post("/super-admin/reject-report", verifyJWT, async (req, res) => {

    const super_admin = req.super_admin;

    try {

        if(!super_admin){
            return res.status(403).json({ error: "not allowed" })
        }

        const { _id } = req.body;

        await Report.findOneAndDelete({ _id });

        return res.status(200).json({ status: "done" })

    } catch(err){
        console.log(err);
        return res.status(500).json({ error: err.message })
    }

})

const warnUser = async (_id, reason, img = null) => {
    try {

        // check user is warned before or not
        const user = await User.findOne({ _id });

        if(user.warned){ return }

        const alert = { type: "warn", action: "warned", reason };

        if(img){
            alert.img = img;
        }

        await User.findOneAndUpdate({ _id }, {
            warned: true,
            $push: { alerts: alert }
        });

    } catch(err){ console.log(err) }
}

server.post("/super-admin/warn-user", verifyJWT, async (req, res) => {

    const super_admin = req.super_admin;

    try {

        if(!super_admin){
            return res.status(403).json({ error: "not allowed" })
        }

        const { _id, note, report_id, img } = req.body;

        warnUser(_id, note, img); 

        // delete report 

        await Report.findOneAndDelete({ _id: report_id });

        return res.status(200).json({ status: "done" });

    } catch(err){
        console.log(err);
        return res.status(500).json({ error: err.message })
    }

})

const deleteUser = async (_id) => {
    try {

        // find the user and get all the blog ids, delete blogs, comments, activites, notifications, reports and update categories

        const user = await User.findOne({ _id }).select("blogs personal_info");

        if(!user){ return }

        const blogIds = user.blogs.map(id => id.toString());

        if(blogIds.length){ // delete blogs with linked docs in all collections

            // Get all comments across all blogs
            const commentsToDelete = await Comment.find({ blog_id: { $in: blogIds } }).select("_id");
            const commentIds = commentsToDelete.map(c => c._id);

            // loop through blogs to delete data

            await Promise.all([
                ...blogIds.map(async id => {
                    
                    const blog = await Blog.findOne({ _id: id }).select("category draft");

                    if(blog){
                        await Blog.findOneAndDelete({ _id: id });

                        // update categories

                        if(!blog.draft){
                            await Category.findOneAndUpdate({ _id: blog.category }, { $inc: { "blog_count": -1 } })
                        }   
                    }

                }),
                Comment.deleteMany({ blog_id: { $in: blogIds } }), // delete comments linked to this blog
                Activity.deleteMany({ ref: { $in: [...commentIds, ...blogIds] } }), // delete activities linked with this blog
                Notification.deleteMany({ blog: { $in: blogIds } }), // delete notifications linked with this blog
            ])

        }

        // delete comments made by this user

        // find all the comments made by this user
        const comments = await Comment.find({ commented_by: _id }).select("_id isReply blog_id");

        // Extract their ids
        const blogUpdates = {};
        const commentIds = [];

        for (const c of comments) {
            
            commentIds.push(c._id); // storing _id in commentIds

            if (!blogUpdates[c.blog_id]) { // checking this comment's blog exists in blog update object or not
                blogUpdates[c.blog_id] = { parentCountToDec: 0, commentIds: [], commentCountToDec: 0 };
            }

            blogUpdates[c.blog_id].commentIds.push(c._id); // storing comment id refrence for later update

            if (!c.isReply) { // tracking parent comments count to update the blog later on
                blogUpdates[c.blog_id].parentCountToDec++;
            }

            blogUpdates[c.blog_id].commentCountToDec++;
            
        }

        // Delete all comments in commentIds
        await Comment.deleteMany({ _id: { $in: commentIds } });

        // Pull those comment ids from blogs
        const updates = Object.entries(blogUpdates).map(([blogId, data]) =>
            Blog.updateOne(
                { _id: blogId },
                {
                    $pull: { comments: { $in: data.commentIds } },
                    $inc: { 'activity.total_parent_comments': -data.parentCountToDec, 'activity.total_comments': -data.commentCountToDec },
                }
            )
        );

        await Promise.all(updates);

        // delete activities made by this user
        await Activity.deleteMany({ user: _id })

        // delete notifications made by this user
        await Notification.deleteMany({ user: _id });

        // delete reports on this user
        await Report.deleteMany({ user: _id });

        // delete user
        await User.findOneAndDelete({ _id: _id });

        await new Ban({ email: user.personal_info.email }).save(); // add user to ban list from prevening new account creation

    } catch(err){ console.log(err) }
}

server.post("/super-admin/ban-user", verifyJWT, async (req, res) => {
    
    const super_admin = req.super_admin;

    try {

        if(!super_admin){
            return res.status(403).json({ error: "not allowed" })
        }

        const { _id } = req.body;

        await deleteUser(_id);

        return res.status(200).json({ status: "done" })
        
    } catch(err) {
        console.log(err);
        return res.status(500).json({ error: err.message })
    }

})

server.post("/stats", verifyJWT, async (req, res) => {

    const super_admin = req.super_admin;

    try {

        if(!super_admin){
            return res.status(403).json({ error: "not allowed" })
        }

        // user count, blog count, report counts, communities count, userdocs with createdAt data, earning count

        const usersCount = await User.countDocuments({});
        const blogsCount = await Blog.countDocuments({});
        const reportsCount = await Report.countDocuments({});
        const communitiesCount = await Community.countDocuments({});

        const totalEarning = usersCount * 5;

        const now = new Date();
        const past30Days = new Date();
        past30Days.setDate(now.getDate() - 30);

        // Fetch users created in last 28 days, only joinedAt (or createdAt) field
        const recentUsers = await User.aggregate([
              { $match: { joinedAt: { $gte: past30Days } } },
                {
                    $group: {
                    _id: {
                        $dateTrunc: {
                        date: "$joinedAt",
                        unit: "day"
                        }
                    },
                    count: { $sum: 1 }
                    }
                },
                {
                    $project: {
                    _id: 0,
                    date: { $dateToString: { format: "%Y-%m-%d", date: "$_id" } },
                    count: 1
                    }
                },
                { $sort: { date: 1 } }
            ]);


        return res.status(200).json({
            usersCount,
            blogsCount,
            reportsCount,
            communitiesCount,
            totalEarning,
            recentUsers
        })

    } catch(err){
        console.log(err);
        return res.status(500).json({ error: err.message })
    }

})

server.listen(PORT, () => {
    console.log('listening on port -> ' + PORT);
})