import mongoose, { Schema } from "mongoose";

let profile_imgs_name_list = ["Garfield", "Tinkerbell", "Annie", "Loki", "Cleo", "Angel", "Bob", "Mia", "Coco", "Gracie", "Bear", "Bella", "Abby", "Harley", "Cali", "Leo", "Luna", "Jack", "Felix", "Kiki"];
let profile_imgs_collections_list = ["notionists-neutral", "adventurer-neutral", "fun-emoji"];

const userSchema = mongoose.Schema({

    personal_info: {
        fullname: {
            type: String,
            lowercase: true,
            required: true,
            minlength: [3, 'fullname must be 3 letters long'],
        },
        email: {
            type: String,
            required: true,
            lowercase: true,
            unique: true
        },
        password: String,
        username: {
            type: String,
            minlength: [3, 'Username must be 3 letters long'],
            unique: true,
        },
        bio: {
            type: String,
            maxlength: [200, 'Bio should not be more than 200'],
            default: "",
        },
        profile_img: {
            type: String,
            default: () => {
                return `https://api.dicebear.com/6.x/${profile_imgs_collections_list[Math.floor(Math.random() * profile_imgs_collections_list.length)]}/svg?seed=${profile_imgs_name_list[Math.floor(Math.random() * profile_imgs_name_list.length)]}`
            } 
        },
        birthdate: {
            type: String,
        },
        gender: {
            type: String,
            enum: ["men", "women", "other"]
        },
        interests: {
            type: [String]
        }
    },
    social_links: {
        youtube: {
            type: String,
            default: "",
        },
        instagram: {
            type: String,
            default: "",
        },
        facebook: {
            type: String,
            default: "",
        },
        twitter: {
            type: String,
            default: "",
        },
        github: {
            type: String,
            default: "",
        },
        website: {
            type: String,
            default: "",
        }
    },
    account_info:{
        total_posts: {
            type: Number,
            default: 0
        },
        total_reads: {
            type: Number,
            default: 0
        },
    },
    google_auth: {
        type: Boolean,
        default: false
    },
    super_admin: {
        type: Boolean,
        default: false
    },
    blogs: {
        type: [ Schema.Types.ObjectId ],
        ref: 'blogs',
        default: [],
    },
    communities: {
        type: [Schema.Types.ObjectId],
        ref: 'communities',
        default: []
    },
    alerts: {
        type: [
            {
                type: {
                    type: String,
                    enum: ["blog", "comment", "reply", "warning"],
                    required: true
                },
                action: {
                    type: String,
                    enum: ["deleted", "warned"],
                    default: "deleted"
                },
                content: String,
                reason: {
                    type: String,
                    required: true
                },
                img: String
            }
        ],
        default: []
    },
    warned: {
        type: Boolean,
        default: false
    }

}, 
{ 
    timestamps: {
        createdAt: 'joinedAt'
    } 

})

export default mongoose.model("users", userSchema);

// server.get("/api-check", async (req, res) => {
//   try {

//     const prompt = `
//     You are a content moderation AI.
//     Analyze the following text and respond in JSON with:
//     {"flagged": true/false, "reasons": ["violence", "hate", "sexual", "harassment", ...]}
    
//     Text to analyze: "let's demolish government"
//     `;

//     const response = await ai.models.generateContent({
//         model: "gemini-2.5-flash-lite",
//         contents: prompt
//     });

//     // Gemini responses come as rich objects; get plain text:
    
//     const raw = response.text; // the model output string
//     const result = JSON.parse(raw.substring(7, raw.length-3));

//     return res.status(200).json({ result });

//   } catch (error) {
//     console.error("Gemini moderation error:", error);
//     return res.status(500).json({ error: error.message });
//   }
// });