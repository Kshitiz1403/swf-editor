var customerApplication = {
  id: "customerapplication",
  name: "Customer Application Workflow",
  version: "1.0",
  specVersion: "0.7",
  timeouts: {
    workflowExecTimeout: {
      duration: "PT1M",
    },
    actionExecTimeout: "PT10S",
  },
  retries: [
    {
      name: "WorkflowRetries",
      delay: "PT3S",
      maxAttempts: 10,
    },
  ],
  start: "NewCustomerApplication",
  states: [
    {
      name: "NewCustomerApplication",
      type: "event",
      onEvents: [
        {
          eventRefs: ["NewApplicationEvent"],
          actionMode: "parallel",
          actions: [
            {
              name: "Invoke Check Customer Info Function",
              functionRef: "CheckCustomerInfo",
            },
            {
              name: "Invoke Update Application Info Function",
              functionRef: "UpdateApplicationInfo",
            },
          ],
        },
      ],
      transition: "MakeApplicationDecision",
    },
    {
      name: "MakeApplicationDecision",
      type: "switch",
      dataConditions: [
        {
          condition: "$..[?(@.age >= 20)]",
          transition: "ApproveApplication",
        },
        {
          condition: "$..[?(@.age < 20)]",
          transition: "RejectApplication",
        },
      ],
      defaultCondition: {
        transition: "RejectApplication",
      },
    },
    {
      name: "ApproveApplication",
      type: "operation",
      actions: [
        {
          name: "Invoke Approve Application Function",
          functionRef: "ApproveApplication",
          sleep: {
            before: "PT1S",
          },
        },
      ],
      end: true,
    },
    {
      name: "RejectApplication",
      type: "operation",
      actions: [
        {
          name: "Invoke Reject Application Function",
          functionRef: "RejectApplication",
          sleep: {
            before: "PT1S",
          },
        },
      ],
      end: true,
    },
  ],
  functions: [
    {
      name: "CheckCustomerInfo",
      type: "rest",
    },
    {
      name: "UpdateApplicationInfo",
      type: "rest",
    },
    {
      name: "ApproveApplication",
      type: "rest",
    },
    {
      name: "RejectApplication",
      type: "rest",
    },
  ],
  events: [
    {
      name: "NewApplicationEvent",
      type: "com.fasterxml.jackson.databind.JsonNode",
      source: "applicationsSource",
    },
  ],
};


var examplesMap = {};
examplesMap["customerapplication"] = customerApplication;

var LOCAL_STORAGE_SWF_JSON = "lastSWFJson";
var LOCAL_STORAGE_SPLIT_SIZES = "split-sizes";


function generateDiagram() {
  const { Specification, MermaidDiagram } = serverWorkflowSdk;

  const model = monaco.editor.getModels()[0];
  const modelVal = model.getValue();

  const mermaidSource = new MermaidDiagram(
    Specification.Workflow.fromSource(modelVal)
  ).sourceCode();
  const mermaidDiv = document.querySelector(".workflowdiagram");

  mermaid.mermaidAPI.render("mermaid", mermaidSource, (svgCode) => {
    mermaidDiv.innerHTML = svgCode;
  });
  panzoom(document.querySelector("#mermaid"))
}


function mountEditor() {
  monaco.editor.getModels()[0].onDidChangeContent(e =>{
  saveToLocalStorage();
  })
}

var editor

document.addEventListener('DOMContentLoaded', () => {
  const toggleButton = document.getElementById('theme-toggle');
  setTheme(localStorage.getItem("theme") === "dark")

  generateDiagram()

  // Function to toggle the 'darkTheme' class on all elements that require it
  function setTheme(isDarkMode) {
    // Select all elements that should use dark theme and toggle the 'darkTheme' class
    document.querySelectorAll('.theme').forEach(element => {
        if (isDarkMode) {
            element.classList.add('darkTheme');  // Apply dark theme
            element.classList.remove('lightTheme'); // Remove light theme
        } else {
            element.classList.remove('darkTheme');  // Remove dark theme
            element.classList.add('lightTheme'); // Apply light theme
        }
    });

    if (isDarkMode){
      // Initialize Monaco editor
      editor = monaco.editor.create(document.getElementById("sweditor"), {
        model: model, // Assume 'model' is defined elsewhere
        theme: "vs-dark" // Default to light theme
      });
      mermaid.mermaidAPI.initialize({ theme: 'dark' , startOnLoad:false});
      localStorage.setItem("theme", "dark")
      document.querySelector(".gutter").style.backgroundColor="rgb(50,50,50)"
    }else{

      // Initialize Monaco editor
      editor = monaco.editor.create(document.getElementById("sweditor"), {
        model: model, // Assume 'model' is defined elsewhere
        theme: "vs-light" // Default to light theme
      });
      mermaid.mermaidAPI.initialize({ theme: 'default', startOnLoad:false });
      localStorage.setItem("theme", "light")
      document.querySelector(".gutter").style.backgroundColor="#eee"

    }
  }


  function toggleTheme(){
    const currentTheme = localStorage.getItem('theme');

    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';

    localStorage.setItem('theme', nextTheme);

    location.reload();
  }

  toggleButton.addEventListener('click', () => {
   toggleTheme();
  })
});

function formatJSON(){
  const model = monaco.editor.getModels()[0];
  const modelVal = model.getValue();
  const json = JSON.parse(modelVal);
  const formattedJson = JSON.stringify(json, null, 2);
  model.setValue(formattedJson);
}

function saveToLocalStorage(){
  const model = monaco.editor.getModels()[0];
  const modelVal = model.getValue();

  localStorage.setItem(LOCAL_STORAGE_SWF_JSON, modelVal);
}

async function goFullScreen() {
  var elem = document.querySelector(".workflowdiagram");
  elem.style.overflow = "auto";
  const done = await elem.requestFullscreen();
}

function getWorkflowName(){
  try {
    const model = monaco.editor.getModels()[0];
    const modelVal = model.getValue();
    const json = JSON.parse(modelVal);
    return json.name;
  } catch (error) {
    return "swf"
  }
}

function generateImageFromSVG(quality) {
  var svgElement = document
    .querySelector(".workflowdiagram")
    .querySelector("svg");

  // Create a new Image object
  var img = new Image();

  // Clone the SVG element
  var clonedSvgElement = svgElement.cloneNode(true);

  var viewBox = clonedSvgElement.viewBox.baseVal;

  const scalingFactor = 5 * quality;

  // Set the width and height of the SVG to its actual size
  clonedSvgElement.setAttribute("width", viewBox.width * scalingFactor);
  clonedSvgElement.setAttribute("height", viewBox.height * scalingFactor);

  // Create a new rect element
  var rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");

  // Set the width and height of the rect to the size of the SVG
  rect.setAttribute("width", viewBox.width * scalingFactor);
  rect.setAttribute("height", viewBox.height * scalingFactor);

  // Set the fill of the rect to white
  rect.setAttribute("fill", "white");

  // Insert the rect at the beginning of the SVG
  clonedSvgElement.insertBefore(rect, clonedSvgElement.firstChild);

  // Serialize the SVG element to a string
  var svgData = new XMLSerializer().serializeToString(clonedSvgElement);

  // Set the src of the image to the SVG data
  img.src = "data:image/svg+xml;base64," + btoa(svgData);

  img.onload = function () {
    // Create a new canvas element
    var canvas = document.createElement("canvas");

    // Set the width and height of the canvas to the width and height of the image
    canvas.width = img.width;
    canvas.height = img.height;

    // Get the 2D context of the canvas
    var ctx = canvas.getContext("2d");

    // Draw the image onto the canvas
    ctx.drawImage(img, 0, 0, img.width, img.height);

    // Get the data URL of the image
    var dataURL = canvas.toDataURL("image/jpeg");

    // Create a new a element
    var link = document.createElement("a");

    // Set the href of the link to the data URL of the image
    link.href = dataURL;

    // Set the download attribute of the link
    link.download = `${getWorkflowName()}.jpeg`;

    // Programmatically click the link to start the download
    link.click();
  };
}

document.addEventListener("keydown", function (event) {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    generateDiagram();
  }
});

function changeTheme(theme) {
  if (theme.length > 0) {
    monaco.editor.setTheme(theme);
  }
}

var sizes = localStorage.getItem(LOCAL_STORAGE_SPLIT_SIZES)

if (sizes) {
    sizes = JSON.parse(sizes)
} else {
    sizes = [50, 50] // default sizes
}


Split(['#editor-col', '#diagram-col'], {
  sizes: sizes,
  onDrag: () => {
      editor.layout({ width: 0, height: 0 })

      window.requestAnimationFrame(()=>{

        const sizeEditor = document.querySelector('#editor-col').getBoundingClientRect();
  
        editor.layout({ width: sizeEditor.width, height: sizeEditor.height })
      })

  },
  onDragEnd:(sizes)=>{
    localStorage.setItem(LOCAL_STORAGE_SPLIT_SIZES, JSON.stringify(sizes))
  },
})